-- Migration: add encrypted memory storage to user_memory.
-- Run with: wrangler d1 execute spark-companion --remote --file=./schema-encrypted.sql

ALTER TABLE user_memory ADD COLUMN encrypted_body BLOB;
ALTER TABLE user_memory ADD COLUMN nonce BLOB;
ALTER TABLE user_memory ADD COLUMN cipher_version INTEGER DEFAULT 1;
