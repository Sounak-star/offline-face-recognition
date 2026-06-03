import { useCallback, useState } from 'react';
import { CameraWithGate } from '@/components/CameraWithGate';
import type { GateState } from '@/components/CameraWithGate';

export default function EnrollScreen() {
  const [gate, setGate] = useState<GateState>({ status: 'no-face', hint: '' });

  const handleGate = useCallback((state: GateState) => {
    setGate(state);
    // Phase 2: when state.status === 'good', trigger face capture + embedding.
  }, []);

  return (
    <CameraWithGate
      badge="📷 Enroll"
      onGate={handleGate}
    />
  );
}
