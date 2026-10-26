export interface ValidationResult {
  isValid: boolean;
  chainType: 'evm' | 'solana' | 'flow' | 'other';
  normalizedAddress: string;
  error?: string;
  detectedFormat?: string;
}

// Base58 characters used in Solana / Bitcoin
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_REGEX = /^0x[a-fA-F0-9]{40}$/;
const FLOW_REGEX = /^0x[a-fA-F0-9]{16}$/;

/**
 * Validates a blockchain wallet address against supported chain formats
 */
export function validateWalletAddress(address: string, specifiedChainType?: string): ValidationResult {
  if (!address || typeof address !== 'string') {
    return {
      isValid: false,
      chainType: 'other',
      normalizedAddress: '',
      error: 'Wallet address cannot be empty',
    };
  }

  const clean = address.trim();

  // If specific chain is designated
  if (specifiedChainType === 'evm' || (!specifiedChainType && EVM_REGEX.test(clean))) {
    if (!EVM_REGEX.test(clean)) {
      return {
        isValid: false,
        chainType: 'evm',
        normalizedAddress: clean,
        error: 'Invalid EVM address: must start with 0x followed by exactly 40 hexadecimal characters.',
      };
    }
    return {
      isValid: true,
      chainType: 'evm',
      normalizedAddress: clean.toLowerCase(),
      detectedFormat: 'Ethereum / EVM (42 hex chars)',
    };
  }

  if (specifiedChainType === 'solana' || (!specifiedChainType && BASE58_REGEX.test(clean))) {
    if (!BASE58_REGEX.test(clean)) {
      return {
        isValid: false,
        chainType: 'solana',
        normalizedAddress: clean,
        error: 'Invalid Solana address: must be a 32-44 character Base58 encoded string.',
      };
    }
    return {
      isValid: true,
      chainType: 'solana',
      normalizedAddress: clean,
      detectedFormat: 'Solana (Base58)',
    };
  }

  if (specifiedChainType === 'flow' || (!specifiedChainType && FLOW_REGEX.test(clean))) {
    if (!FLOW_REGEX.test(clean)) {
      return {
        isValid: false,
        chainType: 'flow',
        normalizedAddress: clean,
        error: 'Invalid Flow address: must start with 0x followed by 16 hex characters.',
      };
    }
    return {
      isValid: true,
      chainType: 'flow',
      normalizedAddress: clean.toLowerCase(),
      detectedFormat: 'Flow (18 hex chars)',
    };
  }

  return {
    isValid: false,
    chainType: 'other',
    normalizedAddress: clean,
    error: `Unsupported address format "${clean}". Expected EVM (0x... 40 hex chars) or Solana (32-44 Base58 chars).`,
  };
}
