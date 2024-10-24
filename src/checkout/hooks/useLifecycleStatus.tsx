import { useCallback, useState } from 'react';
import { CHECKOUT_LIFECYCLESTATUS } from '../constants';
import type { LifecycleStatus, LifecycleStatusUpdate } from '../types';
import type { UseLifecycleStatusReturn } from '../types';

export function useLifecycleStatus(
  initialState: LifecycleStatus,
): UseLifecycleStatusReturn {
  const [lifecycleStatus, setLifecycleStatus] =
    useState<LifecycleStatus>(initialState); // Component lifecycle

  // Update lifecycle status, statusData will be persisted for the full lifecycle
  const updateLifecycleStatus = useCallback(
    (newStatus: LifecycleStatusUpdate) => {
      setLifecycleStatus((prevStatus: LifecycleStatus) => {
        // do not persist errors
        const persistedStatusData =
          prevStatus.statusName === CHECKOUT_LIFECYCLESTATUS.ERROR
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

  return { lifecycleStatus, updateLifecycleStatus };
}