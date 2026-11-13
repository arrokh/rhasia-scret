-- Verify rhasia-scret-api:init on pg
-- Fingerprint includes application table structure and schema-level extensions, types, relations,
-- routines, triggers, and row-security policies. Column ordinals normalize historical attnum gaps.

\set ON_ERROR_STOP on

BEGIN;

DO $verify$
DECLARE
    actual_table_count bigint;
    actual_object_count bigint;
    actual_fingerprint text;
    deployed_later_change_count bigint;
BEGIN
    SELECT count(*)
    INTO deployed_later_change_count
    FROM sqitch.changes
    WHERE project = 'rhasia-scret-api' AND change <> 'init';

    -- The immutable baseline is exact until a later Sqitch change extends the schema.
    -- Each later change must verify the full schema as it exists after that change.
    IF deployed_later_change_count = 0 THEN
        WITH app_tables AS (
        SELECT c.oid, n.nspname, c.relname, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> '_prisma_migrations'
    ), objects AS (
        SELECT format(
            'table|%s|%s|%s|%s|%s|%s',
            nspname,
            relname,
            relkind,
            relpersistence,
            relrowsecurity,
            relforcerowsecurity
        ) AS definition
        FROM app_tables
        UNION ALL
        SELECT format(
            'column|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            t.nspname,
            t.relname,
            row_number() OVER (PARTITION BY t.oid ORDER BY a.attnum),
            a.attname,
            pg_catalog.format_type(a.atttypid, a.atttypmod),
            a.attnotnull,
            COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid, true), ''),
            a.attidentity,
            a.attgenerated
        ) AS definition
        FROM app_tables AS t
        JOIN pg_attribute AS a ON a.attrelid = t.oid
        LEFT JOIN pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped
        UNION ALL
        SELECT format(
            'constraint|%s|%s|%s|%s|%s|%s|%s|%s',
            t.nspname,
            t.relname,
            c.conname,
            c.contype,
            pg_catalog.pg_get_constraintdef(c.oid, true),
            c.condeferrable,
            c.condeferred,
            c.convalidated
        ) AS definition
        FROM app_tables AS t
        JOIN pg_constraint AS c ON c.conrelid = t.oid
        UNION ALL
        SELECT format(
            'index|%s|%s|%s|%s|%s|%s|%s',
            t.nspname,
            t.relname,
            i.relname,
            pg_catalog.pg_get_indexdef(x.indexrelid),
            x.indisvalid,
            x.indisready,
            x.indislive
        ) AS definition
        FROM app_tables AS t
        JOIN pg_index AS x ON x.indrelid = t.oid
        JOIN pg_class AS i ON i.oid = x.indexrelid
        UNION ALL
        SELECT format('extension|%s|%s|%s', n.nspname, e.extname, e.extversion) AS definition
        FROM pg_extension AS e
        JOIN pg_namespace AS n ON n.oid = e.extnamespace
        WHERE n.nspname = 'public'
        UNION ALL
        SELECT format(
            'sequence|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            n.nspname,
            c.relname,
            c.relpersistence,
            s.seqstart,
            s.seqincrement,
            s.seqmax,
            s.seqmin,
            s.seqcache,
            s.seqcycle
        ) AS definition
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        JOIN pg_sequence AS s ON s.seqrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'S'
        UNION ALL
        SELECT format(
            'view|%s|%s|%s|%s|%s',
            n.nspname,
            c.relname,
            c.relkind,
            c.relpersistence,
            pg_catalog.pg_get_viewdef(c.oid, true)
        ) AS definition
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
        UNION ALL
        SELECT format('relation|%s|%s|%s|%s', n.nspname, c.relname, c.relkind, c.relpersistence) AS definition
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind NOT IN ('r', 'p', 'i', 'I', 'S', 'v', 'm')
        UNION ALL
        SELECT format(
            'type|%s|%s|%s|%s|%s|%s|%s',
            n.nspname,
            t.typname,
            t.typtype,
            t.typcategory,
            CASE WHEN t.typbasetype = 0 THEN '' ELSE pg_catalog.format_type(t.typbasetype, t.typtypmod) END,
            t.typnotnull,
            COALESCE(t.typdefault, '')
        ) AS definition
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typrelid = 0 AND t.typelem = 0 AND t.typtype <> 'p'
        UNION ALL
        SELECT format(
            'routine|%s|%s|%s',
            n.nspname,
            p.proname,
            CASE
                WHEN p.prokind = 'a' THEN format(
                    'aggregate|%s|%s|%s|%s|%s',
                    pg_catalog.pg_get_function_identity_arguments(p.oid),
                    pg_catalog.format_type(p.prorettype, NULL),
                    p.prosrc,
                    p.probin,
                    l.lanname
                )
                ELSE pg_catalog.pg_get_functiondef(p.oid)
            END
        ) AS definition
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        JOIN pg_language AS l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
        UNION ALL
        SELECT format('trigger|%s|%s|%s', n.nspname, c.relname, pg_catalog.pg_get_triggerdef(t.oid, true)) AS definition
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        UNION ALL
        SELECT format(
            'policy|%s|%s|%s|%s|%s|%s|%s|%s',
            n.nspname,
            c.relname,
            p.polname,
            p.polcmd,
            p.polpermissive,
            COALESCE((
                SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
                FROM unnest(p.polroles) AS policy_role(role_oid)
                LEFT JOIN pg_roles AS r ON r.oid = policy_role.role_oid
            ), ''),
            COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid, true), ''),
            COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true), '')
        ) AS definition
        FROM pg_policy AS p
        JOIN pg_class AS c ON c.oid = p.polrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
    )
    SELECT
        (SELECT count(*) FROM app_tables),
        count(*),
        md5(string_agg(definition, E'\n' ORDER BY definition))
    INTO actual_table_count, actual_object_count, actual_fingerprint
    FROM objects;

    IF actual_table_count <> 21 THEN
        RAISE EXCEPTION 'Expected 21 application tables, found %.', actual_table_count;
    END IF;
    IF actual_object_count <> 311 THEN
        RAISE EXCEPTION 'Expected 311 schema objects, found %.', actual_object_count;
    END IF;
        IF actual_fingerprint <> 'b81a989c05af1325f6faadd7e1b0b6fa' THEN
            RAISE EXCEPTION 'Application schema fingerprint mismatch: %.', actual_fingerprint;
        END IF;
    END IF;
END
$verify$;

ROLLBACK;
