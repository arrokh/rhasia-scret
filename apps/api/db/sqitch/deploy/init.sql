-- Deploy rhasia-scret-api:init to pg
-- Schema-only DDL captured from a fresh synthetic database after checked-in Prisma migrations.
-- Excludes Prisma migration metadata; application data is never included.
\set ON_ERROR_STOP on

BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_deletion_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_challenges (
    id text NOT NULL,
    application_user_id text NOT NULL,
    session_id text,
    purpose text NOT NULL,
    otp_digest bytea,
    authorization_digest bytea,
    attempt_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    verified_at timestamp(3) without time zone,
    consumed_at timestamp(3) without time zone,
    completed_deletion_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: account_deletion_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_identities (
    id text NOT NULL,
    deletion_record_id text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    deleted_at timestamp(3) without time zone NOT NULL,
    normalized_email text
);


--
-- Name: account_deletion_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_metrics (
    id text NOT NULL,
    auth_backend text NOT NULL,
    personal_vault_count integer NOT NULL,
    shared_vault_deleted_count integer NOT NULL,
    shared_vault_transferred_count integer NOT NULL,
    authenticator_account_count integer NOT NULL,
    occurred_at timestamp(3) without time zone NOT NULL
);


--
-- Name: account_deletion_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_deletion_records (
    id text NOT NULL,
    application_user_id text NOT NULL,
    email text NOT NULL,
    auth_backend text NOT NULL,
    requested_at timestamp(3) without time zone NOT NULL,
    completed_at timestamp(3) without time zone NOT NULL,
    email_delivery_status text NOT NULL,
    personal_vault_count integer NOT NULL,
    shared_vault_deleted_count integer NOT NULL,
    shared_vault_transferred_count integer NOT NULL,
    authenticator_account_count integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: anonymous_auth_rate_limit_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anonymous_auth_rate_limit_windows (
    bucket_hash bytea NOT NULL,
    operation text NOT NULL,
    window_started_at timestamp(3) without time zone NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    request_count integer NOT NULL
);


--
-- Name: application_rate_limit_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_rate_limit_windows (
    user_id text NOT NULL,
    operation text NOT NULL,
    window_started_at timestamp(3) without time zone NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    request_count integer NOT NULL
);


--
-- Name: application_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_users (
    id text NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id text NOT NULL,
    application_user_id text NOT NULL,
    access_token_digest bytea NOT NULL,
    refresh_token_digest bytea NOT NULL,
    refresh_family text NOT NULL,
    access_expires_at timestamp(3) without time zone NOT NULL,
    refresh_expires_at timestamp(3) without time zone NOT NULL,
    revoked_at timestamp(3) without time zone,
    revocation_reason text,
    refresh_rotated_at timestamp(3) without time zone,
    reuse_detected_at timestamp(3) without time zone,
    last_used_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: authenticator_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authenticator_accounts (
    id text NOT NULL,
    vault_id text NOT NULL,
    encrypted_payload bytea NOT NULL,
    encryption_version integer NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    deleted_at timestamp(3) without time zone,
    purge_after timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: external_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_identities (
    id text NOT NULL,
    application_user_id text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    email text,
    email_verified_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: identity_security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_security_events (
    id text NOT NULL,
    application_user_id text NOT NULL,
    event_type text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    session_id text
);


--
-- Name: magic_link_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.magic_link_challenges (
    id text NOT NULL,
    normalized_email text NOT NULL,
    purpose text DEFAULT 'sign_in'::text NOT NULL,
    token_digest bytea NOT NULL,
    client text NOT NULL,
    return_path text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: passkey_recovery_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_recovery_challenges (
    id text NOT NULL,
    user_id text NOT NULL,
    purpose text NOT NULL,
    challenge text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: passkey_recovery_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_recovery_credentials (
    user_id text NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports jsonb,
    encrypted_recovery_package bytea NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: passwordless_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passwordless_identities (
    id text NOT NULL,
    external_identity_id text NOT NULL,
    normalized_email text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: pwa_authentication_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pwa_authentication_handoffs (
    id text NOT NULL,
    handoff_id_digest bytea NOT NULL,
    verifier_digest bytea NOT NULL,
    session_id text,
    return_path text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    published_at timestamp(3) without time zone,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    normalized_email text
);


--
-- Name: user_crypto_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_crypto_profiles (
    user_id text NOT NULL,
    vault_unlock_salt bytea NOT NULL,
    wrapped_user_root_key bytea NOT NULL,
    root_key_wrapping_version integer NOT NULL,
    encrypted_personal_vault_key bytea NOT NULL,
    personal_vault_key_encryption_version integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    encrypted_user_private_key bytea,
    user_encryption_key_version integer,
    user_encryption_public_key jsonb
);


--
-- Name: vault_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_audit_events (
    id text NOT NULL,
    vault_id text NOT NULL,
    actor_user_id text NOT NULL,
    event_type text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    target_id text,
    owner_id text,
    retention_purge_after timestamp(3) without time zone
);


--
-- Name: vault_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_invitations (
    id text NOT NULL,
    vault_id text NOT NULL,
    recipient_user_id text,
    link_verifier bytea NOT NULL,
    encrypted_package bytea NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    redeemed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    recipient_email text,
    expires_at timestamp(3) without time zone DEFAULT (CURRENT_TIMESTAMP + '7 days'::interval) NOT NULL
);


--
-- Name: vault_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_members (
    vault_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    encrypted_vault_key bytea,
    key_version integer,
    revoked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    can_add_accounts_override boolean,
    can_delete_accounts_override boolean,
    can_edit_accounts_override boolean,
    permissions_revision integer DEFAULT 1 NOT NULL
);


--
-- Name: vaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vaults (
    id text NOT NULL,
    type text NOT NULL,
    lifecycle text DEFAULT 'ACTIVE'::text NOT NULL,
    owner_id text NOT NULL,
    encrypted_name bytea,
    encryption_version integer NOT NULL,
    deleted_at timestamp(3) without time zone,
    purge_after timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    member_permissions_revision integer DEFAULT 1 NOT NULL,
    members_can_add_accounts boolean DEFAULT false NOT NULL,
    members_can_delete_accounts boolean DEFAULT false NOT NULL,
    members_can_edit_accounts boolean DEFAULT false NOT NULL
);


--
-- Name: account_deletion_challenges account_deletion_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_challenges
    ADD CONSTRAINT account_deletion_challenges_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_identities account_deletion_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_identities
    ADD CONSTRAINT account_deletion_identities_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_metrics account_deletion_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_metrics
    ADD CONSTRAINT account_deletion_metrics_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_records account_deletion_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_records
    ADD CONSTRAINT account_deletion_records_pkey PRIMARY KEY (id);


--
-- Name: anonymous_auth_rate_limit_windows anonymous_auth_rate_limit_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_auth_rate_limit_windows
    ADD CONSTRAINT anonymous_auth_rate_limit_windows_pkey PRIMARY KEY (bucket_hash, operation, window_started_at);


--
-- Name: application_rate_limit_windows application_rate_limit_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_rate_limit_windows
    ADD CONSTRAINT application_rate_limit_windows_pkey PRIMARY KEY (user_id, operation, window_started_at);


--
-- Name: application_users application_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_users
    ADD CONSTRAINT application_users_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: authenticator_accounts authenticator_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authenticator_accounts
    ADD CONSTRAINT authenticator_accounts_pkey PRIMARY KEY (id);


--
-- Name: external_identities external_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_pkey PRIMARY KEY (id);


--
-- Name: identity_security_events identity_security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_security_events
    ADD CONSTRAINT identity_security_events_pkey PRIMARY KEY (id);


--
-- Name: magic_link_challenges magic_link_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magic_link_challenges
    ADD CONSTRAINT magic_link_challenges_pkey PRIMARY KEY (id);


--
-- Name: passkey_recovery_challenges passkey_recovery_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_recovery_challenges
    ADD CONSTRAINT passkey_recovery_challenges_pkey PRIMARY KEY (id);


--
-- Name: passkey_recovery_credentials passkey_recovery_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_recovery_credentials
    ADD CONSTRAINT passkey_recovery_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: passwordless_identities passwordless_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwordless_identities
    ADD CONSTRAINT passwordless_identities_pkey PRIMARY KEY (id);


--
-- Name: pwa_authentication_handoffs pwa_authentication_handoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pwa_authentication_handoffs
    ADD CONSTRAINT pwa_authentication_handoffs_pkey PRIMARY KEY (id);


--
-- Name: user_crypto_profiles user_crypto_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crypto_profiles
    ADD CONSTRAINT user_crypto_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: vault_audit_events vault_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_audit_events
    ADD CONSTRAINT vault_audit_events_pkey PRIMARY KEY (id);


--
-- Name: vault_invitations vault_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_invitations
    ADD CONSTRAINT vault_invitations_pkey PRIMARY KEY (id);


--
-- Name: vault_members vault_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_members
    ADD CONSTRAINT vault_members_pkey PRIMARY KEY (vault_id, user_id);


--
-- Name: vaults vaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaults
    ADD CONSTRAINT vaults_pkey PRIMARY KEY (id);


--
-- Name: account_deletion_challenges_application_user_id_purpose_exp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_challenges_application_user_id_purpose_exp_idx ON public.account_deletion_challenges USING btree (application_user_id, purpose, expires_at);


--
-- Name: account_deletion_challenges_authorization_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_deletion_challenges_authorization_digest_key ON public.account_deletion_challenges USING btree (authorization_digest);


--
-- Name: account_deletion_challenges_completed_deletion_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_challenges_completed_deletion_id_idx ON public.account_deletion_challenges USING btree (completed_deletion_id);


--
-- Name: account_deletion_challenges_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_challenges_expires_at_idx ON public.account_deletion_challenges USING btree (expires_at);


--
-- Name: account_deletion_challenges_otp_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_deletion_challenges_otp_digest_key ON public.account_deletion_challenges USING btree (otp_digest);


--
-- Name: account_deletion_identities_issuer_subject_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_identities_issuer_subject_deleted_at_idx ON public.account_deletion_identities USING btree (issuer, subject, deleted_at);


--
-- Name: account_deletion_identities_normalized_email_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_identities_normalized_email_deleted_at_idx ON public.account_deletion_identities USING btree (normalized_email, deleted_at);


--
-- Name: account_deletion_metrics_occurred_at_auth_backend_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_metrics_occurred_at_auth_backend_idx ON public.account_deletion_metrics USING btree (occurred_at, auth_backend);


--
-- Name: account_deletion_records_application_user_id_completed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_records_application_user_id_completed_at_idx ON public.account_deletion_records USING btree (application_user_id, completed_at);


--
-- Name: account_deletion_records_email_completed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_deletion_records_email_completed_at_idx ON public.account_deletion_records USING btree (email, completed_at);


--
-- Name: anonymous_auth_rate_limit_windows_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX anonymous_auth_rate_limit_windows_expires_at_idx ON public.anonymous_auth_rate_limit_windows USING btree (expires_at);


--
-- Name: application_rate_limit_windows_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX application_rate_limit_windows_expires_at_idx ON public.application_rate_limit_windows USING btree (expires_at);


--
-- Name: auth_sessions_access_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_access_expires_at_idx ON public.auth_sessions USING btree (access_expires_at);


--
-- Name: auth_sessions_access_token_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_sessions_access_token_digest_key ON public.auth_sessions USING btree (access_token_digest);


--
-- Name: auth_sessions_application_user_id_revoked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_application_user_id_revoked_at_idx ON public.auth_sessions USING btree (application_user_id, revoked_at);


--
-- Name: auth_sessions_refresh_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_refresh_expires_at_idx ON public.auth_sessions USING btree (refresh_expires_at);


--
-- Name: auth_sessions_refresh_family_revoked_at_refresh_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_refresh_family_revoked_at_refresh_expires_at_idx ON public.auth_sessions USING btree (refresh_family, revoked_at, refresh_expires_at);


--
-- Name: auth_sessions_refresh_token_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_sessions_refresh_token_digest_key ON public.auth_sessions USING btree (refresh_token_digest);


--
-- Name: auth_sessions_revoked_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_revoked_at_id_idx ON public.auth_sessions USING btree (revoked_at, id);


--
-- Name: authenticator_accounts_purge_after_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authenticator_accounts_purge_after_id_idx ON public.authenticator_accounts USING btree (purge_after, id);


--
-- Name: authenticator_accounts_vault_id_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authenticator_accounts_vault_id_deleted_at_idx ON public.authenticator_accounts USING btree (vault_id, deleted_at);


--
-- Name: external_identities_application_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_identities_application_user_id_idx ON public.external_identities USING btree (application_user_id);


--
-- Name: external_identities_issuer_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_identities_issuer_subject_key ON public.external_identities USING btree (issuer, subject);


--
-- Name: identity_security_events_application_user_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_security_events_application_user_id_created_at_id_idx ON public.identity_security_events USING btree (application_user_id, created_at, id);


--
-- Name: magic_link_challenges_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX magic_link_challenges_expires_at_idx ON public.magic_link_challenges USING btree (expires_at);


--
-- Name: magic_link_challenges_normalized_email_purpose_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX magic_link_challenges_normalized_email_purpose_created_at_idx ON public.magic_link_challenges USING btree (normalized_email, purpose, created_at);


--
-- Name: magic_link_challenges_purpose_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX magic_link_challenges_purpose_expires_at_idx ON public.magic_link_challenges USING btree (purpose, expires_at);


--
-- Name: magic_link_challenges_token_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX magic_link_challenges_token_digest_key ON public.magic_link_challenges USING btree (token_digest);


--
-- Name: passkey_recovery_challenges_user_id_purpose_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passkey_recovery_challenges_user_id_purpose_expires_at_idx ON public.passkey_recovery_challenges USING btree (user_id, purpose, expires_at);


--
-- Name: passkey_recovery_credentials_credential_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX passkey_recovery_credentials_credential_id_key ON public.passkey_recovery_credentials USING btree (credential_id);


--
-- Name: passwordless_identities_external_identity_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX passwordless_identities_external_identity_id_key ON public.passwordless_identities USING btree (external_identity_id);


--
-- Name: passwordless_identities_normalized_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX passwordless_identities_normalized_email_key ON public.passwordless_identities USING btree (normalized_email);


--
-- Name: pwa_authentication_handoffs_consumed_at_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pwa_authentication_handoffs_consumed_at_expires_at_idx ON public.pwa_authentication_handoffs USING btree (consumed_at, expires_at);


--
-- Name: pwa_authentication_handoffs_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pwa_authentication_handoffs_expires_at_idx ON public.pwa_authentication_handoffs USING btree (expires_at);


--
-- Name: pwa_authentication_handoffs_handoff_id_digest_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pwa_authentication_handoffs_handoff_id_digest_key ON public.pwa_authentication_handoffs USING btree (handoff_id_digest);


--
-- Name: pwa_authentication_handoffs_session_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pwa_authentication_handoffs_session_id_key ON public.pwa_authentication_handoffs USING btree (session_id);


--
-- Name: vault_audit_events_retention_purge_after_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_audit_events_retention_purge_after_id_idx ON public.vault_audit_events USING btree (retention_purge_after, id);


--
-- Name: vault_audit_events_vault_id_actor_user_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_audit_events_vault_id_actor_user_id_created_at_id_idx ON public.vault_audit_events USING btree (vault_id, actor_user_id, created_at, id);


--
-- Name: vault_audit_events_vault_id_owner_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_audit_events_vault_id_owner_id_created_at_id_idx ON public.vault_audit_events USING btree (vault_id, owner_id, created_at, id);


--
-- Name: vault_audit_events_vault_id_target_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_audit_events_vault_id_target_id_created_at_id_idx ON public.vault_audit_events USING btree (vault_id, target_id, created_at, id);


--
-- Name: vault_invitations_link_verifier_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vault_invitations_link_verifier_key ON public.vault_invitations USING btree (link_verifier);


--
-- Name: vault_invitations_recipient_email_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_invitations_recipient_email_status_idx ON public.vault_invitations USING btree (recipient_email, status);


--
-- Name: vault_invitations_recipient_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_invitations_recipient_user_id_status_idx ON public.vault_invitations USING btree (recipient_user_id, status);


--
-- Name: vault_invitations_status_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_invitations_status_expires_at_idx ON public.vault_invitations USING btree (status, expires_at);


--
-- Name: vault_invitations_vault_id_status_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_invitations_vault_id_status_created_at_id_idx ON public.vault_invitations USING btree (vault_id, status, created_at, id);


--
-- Name: vault_members_user_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_members_user_id_status_idx ON public.vault_members USING btree (user_id, status);


--
-- Name: vault_members_vault_id_role_status_created_at_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_members_vault_id_role_status_created_at_user_id_idx ON public.vault_members USING btree (vault_id, role, status, created_at, user_id);


--
-- Name: vaults_owner_id_type_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vaults_owner_id_type_lifecycle_idx ON public.vaults USING btree (owner_id, type, lifecycle);


--
-- Name: vaults_type_lifecycle_purge_after_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vaults_type_lifecycle_purge_after_id_idx ON public.vaults USING btree (type, lifecycle, purge_after, id);


--
-- Name: account_deletion_identities account_deletion_identities_deletion_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_deletion_identities
    ADD CONSTRAINT account_deletion_identities_deletion_record_id_fkey FOREIGN KEY (deletion_record_id) REFERENCES public.account_deletion_records(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: application_rate_limit_windows application_rate_limit_windows_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_rate_limit_windows
    ADD CONSTRAINT application_rate_limit_windows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_application_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_application_user_id_fkey FOREIGN KEY (application_user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: authenticator_accounts authenticator_accounts_vault_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authenticator_accounts
    ADD CONSTRAINT authenticator_accounts_vault_id_fkey FOREIGN KEY (vault_id) REFERENCES public.vaults(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: external_identities external_identities_application_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identities
    ADD CONSTRAINT external_identities_application_user_id_fkey FOREIGN KEY (application_user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: identity_security_events identity_security_events_application_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_security_events
    ADD CONSTRAINT identity_security_events_application_user_id_fkey FOREIGN KEY (application_user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: passkey_recovery_challenges passkey_recovery_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_recovery_challenges
    ADD CONSTRAINT passkey_recovery_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: passkey_recovery_credentials passkey_recovery_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_recovery_credentials
    ADD CONSTRAINT passkey_recovery_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: passwordless_identities passwordless_identities_external_identity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passwordless_identities
    ADD CONSTRAINT passwordless_identities_external_identity_id_fkey FOREIGN KEY (external_identity_id) REFERENCES public.external_identities(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pwa_authentication_handoffs pwa_authentication_handoffs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pwa_authentication_handoffs
    ADD CONSTRAINT pwa_authentication_handoffs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_crypto_profiles user_crypto_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_crypto_profiles
    ADD CONSTRAINT user_crypto_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: vault_audit_events vault_audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_audit_events
    ADD CONSTRAINT vault_audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vault_invitations vault_invitations_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_invitations
    ADD CONSTRAINT vault_invitations_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: vault_invitations vault_invitations_vault_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_invitations
    ADD CONSTRAINT vault_invitations_vault_id_fkey FOREIGN KEY (vault_id) REFERENCES public.vaults(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vault_members vault_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_members
    ADD CONSTRAINT vault_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vault_members vault_members_vault_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_members
    ADD CONSTRAINT vault_members_vault_id_fkey FOREIGN KEY (vault_id) REFERENCES public.vaults(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vaults vaults_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaults
    ADD CONSTRAINT vaults_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.application_users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--

COMMIT;
