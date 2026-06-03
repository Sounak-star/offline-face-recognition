import { useCallback, useState } from 'react';
import { CameraWithGate } from '@/components/CameraWithGate';
import type { GateState } from '@/components/CameraWithGate';

export default function VerifyScreen() {
  const [gate, setGate] = useState<GateState>({ status: 'no-face', hint: '' });

  const handleGate = useCallback((state: GateState) => {
    setGate(state);
    // Phase 2: when state.status === 'good', trigger embedding comparison.
  }, []);

  return (
    <CameraWithGate
      badge="✅ Verify"
      onGate={handleGate}
    />
  );
}
