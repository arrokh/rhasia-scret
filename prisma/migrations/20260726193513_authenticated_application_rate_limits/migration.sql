-- CreateTable
CREATE TABLE "application_rate_limit_windows" (
    "user_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL,

    CONSTRAINT "application_rate_limit_windows_pkey" PRIMARY KEY ("user_id","operation","window_started_at")
);

-- CreateIndex
CREATE INDEX "application_rate_limit_windows_expires_at_idx" ON "application_rate_limit_windows"("expires_at");

-- AddForeignKey
ALTER TABLE "application_rate_limit_windows" ADD CONSTRAINT "application_rate_limit_windows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
