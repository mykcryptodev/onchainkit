// 🌲☀🌲
import type { ReactNode } from 'react';
import type { Address, ContractFunctionParameters } from 'viem';

export type TransactionButtonReact = { className?: string; text?: string };

/**
 * Note: exported as public Type
 */
export type TransactionContextType = {
  address: Address;
  contracts: ContractFunctionParameters[];
  errorMessage?: string;
  isLoading: boolean;
  isToastVisible: boolean;
  gasFee?: string;
  onSubmit: () => void;
  setErrorMessage: (error: string) => void;
  setIsToastVisible: (isVisible: boolean) => void;
  setTransactionId: (id: string) => void;
  status?: string;
  transactionId?: string;
  transactionHash?: string;
};

/**
 * Note: exported as public Type
 */
export type TransactionError = {
  code: string; // The error code
  error: string; // The error message
};

export type TransactionErrorState = {
  TransactionError?: TransactionError;
};

/**
 * Note: exported as public Type
 */
export type TransactionReact = {
  address: Address;
  children: ReactNode;
  className?: string;
  contracts: ContractFunctionParameters[];
  onError?: (e: TransactionError) => void;
};

export type TransactionMessageReact = {
  className?: string;
};

export type TransactionProviderReact = {
  address: Address;
  children: ReactNode;
  contracts: ContractFunctionParameters[];
  onError?: (e: TransactionError) => void;
};

export type TransactionSponsorReact = {
  className?: string;
  text?: string;
};

export type TransactionStatusReact = {
  children: ReactNode;
  className?: string;
};

export type TransactionStatusActionReact = {
  className?: string;
};

export type TransactionStatusLabelReact = {
  className?: string;
};

export type TransactionToastActionReact = {
  className?: string;
};

export type TransactionToastIconReact = {
  className?: string;
};

export type TransactionToastLabelReact = {
  className?: string;
};

export type TransactionToastReact = {
  children: ReactNode;
  className?: string;
};