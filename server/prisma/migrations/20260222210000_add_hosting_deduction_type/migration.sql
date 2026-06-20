-- Add hosting_deduction to BalanceLogType enum
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'hosting_deduction';
