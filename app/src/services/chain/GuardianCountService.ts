import bs58 from 'bs58';
import { accountDiscriminator, programId } from '@/chain/program';
import { APP_CONFIG } from '@/config/app';
import type { ShoeLevel } from '@/config/shoeProgression';
import { getConnection } from './ChainClient';

/** Public, wallet-independent count. Historical receipts for this program + kind; not current holders or unique people. */
export async function fetchGuardianCount(level: ShoeLevel): Promise<{ total: number; checkedAt: string }> {
  if (!APP_CONFIG.chainConfigured) throw new Error('Chain is not configured');
  const accounts = await getConnection().getProgramAccounts(programId(), {
    commitment: 'finalized',
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator('CollectibleReceipt')) } },
      { memcmp: { offset: 40, bytes: bs58.encode(Uint8Array.from([level])) } },
    ],
  });
  return { total: accounts.length, checkedAt: new Date().toISOString() };
}
