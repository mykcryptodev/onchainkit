import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type {
  Address,
  TransactionExecutionError,
  TransactionReceipt,
} from 'viem';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { useWaitForTransactionReceipt } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { useValue } from '../../internal/hooks/useValue';
import { METHOD_NOT_SUPPORTED_ERROR_SUBSTRING } from '../constants';
import { useCallsStatus } from '../hooks/useCallsStatus';
import { useWriteContract } from '../hooks/useWriteContract';
import {
  genericErrorMessage,
  useWriteContracts,
} from '../hooks/useWriteContracts';
import type {
  TransactionContextType,
  TransactionProviderReact,
} from '../types';

const emptyContext = {} as TransactionContextType;
export const TransactionContext =
  createContext<TransactionContextType>(emptyContext);

export function useTransactionContext() {
  const context = useContext(TransactionContext);
  if (context === emptyContext) {
    throw new Error(
      'useTransactionContext must be used within a Transaction component',
    );
  }
  return context;
}

export function TransactionProvider({
  address,
  capabilities,
  chainId,
  children,
  contracts,
  onError,
  onSuccess,
}: TransactionProviderReact) {
  const [errorMessage, setErrorMessage] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [transactionHashArray, setTransactionHashArray] = useState<Address[]>(
    [],
  );
  const [receiptArray, setReceiptArray] = useState<TransactionReceipt[]>([]);
  const account = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { status: statusWriteContracts, writeContractsAsync } =
    useWriteContracts({
      onError,
      setErrorMessage,
      setTransactionId,
    });
  const {
    status: statusWriteContract,
    writeContractAsync,
    data: writeContractTransactionHash,
  } = useWriteContract({
    onError,
    setErrorMessage,
    setTransactionHashArray,
    transactionHashArray,
  });
  const { transactionHash, status: callStatus } = useCallsStatus({
    onError,
    transactionId,
  });

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: writeContractTransactionHash || transactionHash,
  });

  const getTransactionReceipts = useCallback(async () => {
    const receipts = [];
    for (const hash of transactionHashArray) {
      try {
        const txnReceipt = await waitForTransactionReceipt(config, {
          hash,
          chainId,
        });
        receipts.push(txnReceipt);
      } catch (err) {
        console.error('getTransactionReceiptsError', err);
        setErrorMessage(genericErrorMessage);
      }
    }
    setReceiptArray(receipts);
  }, [chainId, config, transactionHashArray]);

  useEffect(() => {
    if (
      transactionHashArray.length === contracts.length &&
      contracts?.length > 1
    ) {
      getTransactionReceipts();
    }
  }, [contracts, getTransactionReceipts, transactionHashArray]);

  const fallbackToWriteContract = useCallback(async () => {
    // EOAs don't support batching, so we process contracts individually.
    // This gracefully handles accidental batching attempts with EOAs.
    for (const contract of contracts) {
      try {
        await writeContractAsync?.(contract);
      } catch (err) {
        // if user rejected request
        if (
          (err as TransactionExecutionError)?.cause?.name ===
          'UserRejectedRequestError'
        ) {
          setErrorMessage('Request denied.');
        } else {
          setErrorMessage(genericErrorMessage);
        }
      }
    }
  }, [contracts, writeContractAsync]);

  const switchChain = useCallback(
    async (targetChainId: number | undefined) => {
      if (targetChainId && account.chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
    },
    [account.chainId, switchChainAsync],
  );

  const executeContracts = useCallback(async () => {
    await writeContractsAsync({
      contracts,
      capabilities,
    });
  }, [writeContractsAsync, contracts, capabilities]);

  const handleSubmitErrors = useCallback(
    async (err: unknown) => {
      // handles EOA writeContracts error
      // (fallback to writeContract)
      if (
        err instanceof Error &&
        err.message.includes(METHOD_NOT_SUPPORTED_ERROR_SUBSTRING)
      ) {
        try {
          await fallbackToWriteContract();
        } catch (_err) {
          setErrorMessage(genericErrorMessage);
        }
        // handles user rejected request error
      } else if (
        (err as TransactionExecutionError)?.cause?.name ===
        'UserRejectedRequestError'
      ) {
        setErrorMessage('Request denied.');
        // handles generic error
      } else {
        setErrorMessage(genericErrorMessage);
      }
    },
    [fallbackToWriteContract],
  );

  const handleSubmit = useCallback(async () => {
    setErrorMessage('');
    setIsToastVisible(true);
    try {
      await switchChain(chainId);
      await executeContracts();
    } catch (err) {
      await handleSubmitErrors(err);
    }
  }, [chainId, executeContracts, handleSubmitErrors, switchChain]);

  useEffect(() => {
    if (receiptArray?.length > 1) {
      onSuccess?.(receiptArray);
    } else if (receipt) {
      onSuccess?.(receipt);
    }
  }, [onSuccess, receipt, receiptArray]);

  const value = useValue({
    address,
    chainId,
    contracts,
    errorMessage,
    hasPaymaster: !!capabilities?.paymasterService?.url,
    isLoading: callStatus === 'PENDING',
    isToastVisible,
    onSubmit: handleSubmit,
    receipt,
    setErrorMessage,
    setIsToastVisible,
    setTransactionId,
    statusWriteContracts,
    statusWriteContract,
    transactionId,
    transactionHash: transactionHash || writeContractTransactionHash,
  });
  return (
    <TransactionContext.Provider value={value}>
      {children}
    </TransactionContext.Provider>
  );
}
