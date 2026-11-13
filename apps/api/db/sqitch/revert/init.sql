-- Revert rhasia-scret-api:init from pg
-- The initial schema is a cutover baseline and must never be dropped by Sqitch.
-- Tear down only a run-owned disposable test database with its project volume.

\set ON_ERROR_STOP on

DO $revert$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '0A000',
        MESSAGE = 'The initial schema baseline is irreversible; destroy only its disposable database.';
END
$revert$;
