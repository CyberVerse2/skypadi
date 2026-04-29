export type BankTransferAccount = {
  accountName: string;
  bankName: string;
  accountNumber: string;
};

export function getBankTransferAccount(env: NodeJS.ProcessEnv = process.env): BankTransferAccount {
  const accountName = env.SKYPADI_BANK_ACCOUNT_NAME;
  const bankName = env.SKYPADI_BANK_NAME;
  const accountNumber = env.SKYPADI_BANK_ACCOUNT_NUMBER;

  if (!accountName || !bankName || !accountNumber) {
    throw new Error("Bank transfer account details are not configured");
  }

  return { accountName, bankName, accountNumber };
}
