import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useAccount, useConfig, useSendTransaction } from 'wagmi';
import { buildSwapTransaction } from '../../api/buildSwapTransaction';
import { getSwapQuote } from '../../api/getSwapQuote';
import { useValue } from '../../internal/hooks/useValue';
import { formatTokenAmount } from '../../internal/utils/formatTokenAmount';
import type { Token } from '../../token';
import { GENERIC_ERROR_MESSAGE } from '../../transaction/constants';
import { isUserRejectedRequestError } from '../../transaction/utils/isUserRejectedRequestError';
import { DEFAULT_MAX_SLIPPAGE } from '../constants';
import { useFromTo } from '../hooks/useFromTo';
import { useResetInputs } from '../hooks/useResetInputs';
import type {
  LifecycleStatus,
  LifecycleStatusUpdate,
  SwapContextType,
  SwapProviderReact,
} from '../types';
import { isSwapError } from '../utils/isSwapError';
import { processSwapTransaction } from '../utils/processSwapTransaction';

const emptyContext = {} as SwapContextType;

export const SwapContext = createContext<SwapContextType>(emptyContext);

export function useSwapContext() {
  const context = useContext(SwapContext);
  if (context === emptyContext) {
    throw new Error('useSwapContext must be used within a Swap component');
  }
  return context;
}

export function SwapProvider({
  children,
  config = {
    maxSlippage: DEFAULT_MAX_SLIPPAGE,
  },
  experimental,
  onError,
  onStatus,
  onSuccess,
}: SwapProviderReact) {
  const { address } = useAccount();
  // Feature flags
  const { useAggregator } = experimental;
  // Core Hooks
  const accountConfig = useConfig();
  const [lifecycleStatus, setLifecycleStatus] = useState<LifecycleStatus>({
    statusName: 'init',
    statusData: {
      isMissingRequiredField: true,
      maxSlippage: config.maxSlippage,
    },
  }); // Component lifecycle

  // Update lifecycle status, statusData will be persisted for the full lifecycle
  const updateLifecycleStatus = useCallback(
    (newStatus: LifecycleStatusUpdate) => {
      setLifecycleStatus((prevStatus: LifecycleStatus) => {
        // do not persist errors
        const persistedStatusData =
          prevStatus.statusName === 'error'
            ? (({ error, code, message, ...statusData }) => statusData)(
                prevStatus.statusData,
              )
            : prevStatus.statusData;
        return {
          statusName: newStatus.statusName,
          statusData: {
            ...persistedStatusData,
            ...newStatus.statusData,
          },
        } as LifecycleStatus;
      });
    },
    [],
  );

  const [hasHandledSuccess, setHasHandledSuccess] = useState(false);
  const { from, to } = useFromTo(address);
  const { sendTransactionAsync } = useSendTransaction(); // Sending the transaction (and approval, if applicable)

  // Refreshes balances and inputs post-swap
  const resetInputs = useResetInputs({ from, to });

  // Component lifecycle emitters
  useEffect(() => {
    // Error
    if (lifecycleStatus.statusName === 'error') {
      onError?.(lifecycleStatus.statusData);
    }
    // Success
    if (lifecycleStatus.statusName === 'success') {
      onSuccess?.(lifecycleStatus.statusData.transactionReceipt);
      setHasHandledSuccess(true);
    }
    // Emit Status
    onStatus?.(lifecycleStatus);
  }, [
    onError,
    onStatus,
    onSuccess,
    lifecycleStatus,
    lifecycleStatus.statusData, // Keep statusData, so that the effect runs when it changes
    lifecycleStatus.statusName, // Keep statusName, so that the effect runs when it changes
  ]);

  useEffect(() => {
    // Reset inputs after status reset. `resetInputs` is dependent
    // on 'from' and 'to' so moved to separate useEffect to
    // prevents multiple calls to `onStatus`
    if (lifecycleStatus.statusName === 'init' && hasHandledSuccess) {
      setHasHandledSuccess(false);
      resetInputs();
    }
  }, [hasHandledSuccess, lifecycleStatus.statusName, resetInputs]);

  useEffect(() => {
    // Reset status to init after success has been handled
    if (lifecycleStatus.statusName === 'success' && hasHandledSuccess) {
      updateLifecycleStatus({
        statusName: 'init',
        statusData: {
          isMissingRequiredField: true,
          maxSlippage: config.maxSlippage,
        },
      });
    }
  }, [
    config.maxSlippage,
    hasHandledSuccess,
    lifecycleStatus.statusName,
    updateLifecycleStatus,
  ]);

  const handleToggle = useCallback(() => {
    from.setAmount(to.amount);
    to.setAmount(from.amount);
    from.setToken(to.token);
    to.setToken(from.token);

    updateLifecycleStatus({
      statusName: 'amountChange',
      statusData: {
        amountFrom: from.amount,
        amountTo: to.amount,
        tokenFrom: from.token,
        tokenTo: to.token,
        // token is missing
        isMissingRequiredField:
          !from.token || !to.token || !from.amount || !to.amount,
      },
    });
  }, [from, to, updateLifecycleStatus]);

  const handleAmountChange = useCallback(
    async (
      type: 'from' | 'to',
      amount: string,
      sToken?: Token,
      dToken?: Token,
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO Refactor this component
    ) => {
      const source = type === 'from' ? from : to;
      const destination = type === 'from' ? to : from;

      source.token = sToken ?? source.token;
      destination.token = dToken ?? destination.token;

      // if token is missing alert user via isMissingRequiredField
      if (source.token === undefined || destination.token === undefined) {
        updateLifecycleStatus({
          statusName: 'amountChange',
          statusData: {
            amountFrom: from.amount,
            amountTo: to.amount,
            tokenFrom: from.token,
            tokenTo: to.token,
            // token is missing
            isMissingRequiredField: true,
          },
        });
        return;
      }
      if (amount === '' || amount === '.' || Number.parseFloat(amount) === 0) {
        return destination.setAmount('');
      }

      // When toAmount changes we fetch quote for fromAmount
      // so set isFromQuoteLoading to true
      destination.setLoading(true);
      updateLifecycleStatus({
        statusName: 'amountChange',
        statusData: {
          // when fetching quote, the previous
          // amount is irrelevant
          amountFrom: type === 'from' ? amount : '',
          amountTo: type === 'to' ? amount : '',
          tokenFrom: from.token,
          tokenTo: to.token,
          // when fetching quote, the destination
          // amount is missing
          isMissingRequiredField: true,
        },
      });

      try {
        const maxSlippage = lifecycleStatus.statusData.maxSlippage;
        const response = await getSwapQuote({
          amount,
          amountReference: 'from',
          from: source.token,
          maxSlippage: String(maxSlippage),
          to: destination.token,
          useAggregator,
        });
        // If request resolves to error response set the quoteError
        // property of error state to the SwapError response
        if (isSwapError(response)) {
          updateLifecycleStatus({
            statusName: 'error',
            statusData: {
              code: response.code,
              error: response.error,
              message: '',
            },
          });
          return;
        }
        const formattedAmount = formatTokenAmount(
          response.toAmount,
          response.to.decimals,
        );
        destination.setAmount(formattedAmount);
        updateLifecycleStatus({
          statusName: 'amountChange',
          statusData: {
            amountFrom: type === 'from' ? amount : formattedAmount,
            amountTo: type === 'to' ? amount : formattedAmount,
            tokenFrom: from.token,
            tokenTo: to.token,
            // if quote was fetched successfully, we
            // have all required fields
            isMissingRequiredField: !formattedAmount,
          },
        });
        // prevent rate limits by fetching USD amounts after a delay
        setTimeout(() => {
          fetchAmountUsd({
            token: response.to,
            amount: response.toAmount,
            setAmountUsd: destination.setAmountUsd,
          });
        }, 1500);
        setTimeout(() => {
          fetchAmountUsd({
            token: response.from,
            amount: response.fromAmount,
            setAmountUsd: source.setAmountUsd,
          });
        }, 3000);
      } catch (err) {
        updateLifecycleStatus({
          statusName: 'error',
          statusData: {
            code: 'TmSPc01', // Transaction module SwapProvider component 01 error
            error: JSON.stringify(err),
            message: '',
          },
        });
      } finally {
        // reset loading state when quote request resolves
        destination.setLoading(false);
      }
    },
    [from, to, lifecycleStatus, updateLifecycleStatus, useAggregator],
  );

  const fetchAmountUsd = async ({
    token,
    amount,
    setAmountUsd,
  }: {
    token: Token;
    amount: string;
    setAmountUsd: React.Dispatch<React.SetStateAction<string>>;
  }) => {
    // reset the USD amounts
    setAmountUsd('');

    const USDC: Token = {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      symbol: "USDC",
      chainId: 8453,
      image: "",
      name: "USDC",
    };

    const toUsdQuote = await getSwapQuote({
      amount: formatTokenAmount(amount, token.decimals),
      from: token,
      to: USDC,
      useAggregator,
      maxSlippage: "0",
    });

    console.log({ toUsdQuote });

    if (!isSwapError(toUsdQuote)) {
      setAmountUsd(formatTokenAmount(toUsdQuote.toAmount, toUsdQuote.to.decimals));
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!address || !from.token || !to.token || !from.amount) {
      return;
    }

    try {
      const maxSlippage = lifecycleStatus.statusData.maxSlippage;
      const response = await buildSwapTransaction({
        amount: from.amount,
        fromAddress: address,
        from: from.token,
        maxSlippage: String(maxSlippage),
        to: to.token,
        useAggregator,
      });
      if (isSwapError(response)) {
        updateLifecycleStatus({
          statusName: 'error',
          statusData: {
            code: response.code,
            error: response.error,
            message: response.message,
          },
        });
        return;
      }
      await processSwapTransaction({
        config: accountConfig,
        sendTransactionAsync,
        updateLifecycleStatus,
        swapTransaction: response,
        useAggregator,
      });

      // TODO: refresh balances
    } catch (err) {
      const errorMessage = isUserRejectedRequestError(err)
        ? 'Request denied.'
        : GENERIC_ERROR_MESSAGE;
      updateLifecycleStatus({
        statusName: 'error',
        statusData: {
          code: 'TmSPc02', // Transaction module SwapProvider component 02 error
          error: JSON.stringify(err),
          message: errorMessage,
        },
      });
    }
  }, [
    accountConfig,
    address,
    from.amount,
    from.token,
    lifecycleStatus,
    sendTransactionAsync,
    to.token,
    updateLifecycleStatus,
    useAggregator,
  ]);

  const value = useValue({
    address,
    config,
    from,
    handleAmountChange,
    handleToggle,
    handleSubmit,
    lifecycleStatus,
    updateLifecycleStatus,
    to,
  });

  return <SwapContext.Provider value={value}>{children}</SwapContext.Provider>;
}
