// Settings screen – Phase 3 threshold slider
import { StyleSheet, View, Text, SafeAreaView } from 'react-native';
import { useEffect, useState } from 'react';
import { ThemedText } from '@/components/themed-text';
import { SettingsStore } from '@/services/SettingsStore';
import { MATCH_COSINE_THRESHOLD } from '@/lib/config';
import Slider from '@react-native-community/slider';

export default function SettingsScreen() {
  const [threshold, setThreshold] = useState<number>(MATCH_COSINE_THRESHOLD);

  // Load persisted threshold on mount
  useEffect(() => {
    (async () => {
      const saved = await SettingsStore.getThreshold(MATCH_COSINE_THRESHOLD);
      setThreshold(saved);
    })();
  }, []);

  // Update store whenever threshold changes (debounce optional)
  const onValueChange = (value: number) => {
    setThreshold(value);
    SettingsStore.setThreshold(value);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Settings</ThemedText>
        <ThemedText>Similarity Threshold</ThemedText>
        <View style={styles.sliderContainer}>
          <Slider
            style={styles.slider}
            minimumValue={0.0}
            maximumValue={1.0}
            step={0.01}
            value={threshold}
            minimumTrackTintColor="#0A84FF"
            maximumTrackTintColor="#555"
            thumbTintColor="#0A84FF"
            onValueChange={onValueChange}
          />
          <Text style={styles.valueLabel}>{threshold.toFixed(2)}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safeArea: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'flex-start' },
  sliderContainer: { width: '100%', marginTop: 20, alignItems: 'center' },
  slider: { width: '90%' },
  valueLabel: { color: '#fff', marginTop: 8, fontSize: 16 },
});
