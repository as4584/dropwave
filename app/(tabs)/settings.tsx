import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import GlassView from '../../components/GlassView';
import {
  ACCENT_SWATCHES,
  GRADIENT_PRESETS,
  useTheme,
  withAlpha,
  type BackgroundType,
} from '../../theme/ThemeContext';
import { setCustomBackground, IS_WEB } from '../../lib/library';
import { checkBackend } from '../../lib/api';
import ScreenShell from '../../components/ScreenShell';

function isHex(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

function Segmented<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { id: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.segWrap}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              onPick(o.id);
              void Haptics.selectionAsync();
            }}
            style={[
              styles.segBtn,
              active && { backgroundColor: withAlpha(theme.accent, 0.25) },
            ]}
          >
            <Text style={[styles.segText, active && { color: theme.accent, fontWeight: '700' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <View style={styles.swatchRow}>
      {ACCENT_SWATCHES.map((c) => {
        const active = value.toLowerCase() === c.toLowerCase();
        return (
          <View key={c} style={[styles.swatchRing, active && styles.swatchRingActive]}>
            <Pressable
              onPress={() => {
                onPick(c);
                void Haptics.selectionAsync();
              }}
              style={[styles.swatchDot, { backgroundColor: c }]}
            />
          </View>
        );
      })}
    </View>
  );
}

export default function PersonalizeScreen() {
  const { theme, setTheme, setBackground } = useTheme();
  const insets = useSafeAreaInsets();
  const [accentHex, setAccentHex] = useState(theme.accent);
  const [btnHex, setBtnHex] = useState(theme.buttonColor);
  const [colorHex, setColorHex] = useState(
    theme.background.type === 'color' ? theme.background.value : '#0b0b12'
  );
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    void checkBackend().then(setBackendOk);
  }, []);

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (res.canceled || !res.assets[0]) return;
    const src = res.assets[0].uri;
    try {
      if (IS_WEB) {
        // web has no app filesystem; the picker URI (blob:) works directly
        await setCustomBackground(src);
      } else {
        const dest = `${FileSystem.documentDirectory}bg-custom.jpg`;
        await FileSystem.copyAsync({ from: src, to: dest });
        await setCustomBackground(dest);
      }
      setBackground('image', 'custom');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // copy failed, ignore
    }
  };

  const clearImage = async () => {
    await setCustomBackground(null);
    setBackground('gradient', 'midnight');
  };

  const commitHex = (raw: string, apply: (c: string) => void) => {
    const v = raw.trim();
    if (isHex(v)) {
      apply(v);
      void Haptics.selectionAsync();
    }
  };

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Make it yours</Text>
      <Text style={styles.sub}>Colors, background, and finish. Everything saves instantly.</Text>

      <Text style={styles.label}>Finish</Text>
      <GlassView style={styles.card}>
        <Segmented
          options={[
            { id: 'glossy', label: 'Glossy' },
            { id: 'matte', label: 'Matte' },
          ]}
          value={theme.finish}
          onPick={(v) => setTheme({ finish: v })}
        />
        <Text style={styles.hint}>
          Glossy gives cards a frosted glass look. Matte keeps them flat and solid.
        </Text>
      </GlassView>

      <Text style={styles.label}>Accent color</Text>
      <GlassView style={styles.card}>
        <Swatches value={theme.accent} onPick={(c) => setTheme({ accent: c })} />
        <View style={styles.hexRow}>
          <TextInput
            value={accentHex}
            onChangeText={setAccentHex}
            placeholder="#8b5cf6"
            placeholderTextColor="#6a6a6a"
            style={styles.hexInput}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            onSubmitEditing={() => commitHex(accentHex, (c) => setTheme({ accent: c }))}
          />
          <Pressable
            onPress={() => commitHex(accentHex, (c) => setTheme({ accent: c }))}
            style={[styles.hexBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.hexBtnText}>Apply</Text>
          </Pressable>
        </View>
      </GlassView>

      <Text style={styles.label}>Button color</Text>
      <GlassView style={styles.card}>
        <Swatches value={theme.buttonColor} onPick={(c) => setTheme({ buttonColor: c })} />
        <View style={styles.hexRow}>
          <TextInput
            value={btnHex}
            onChangeText={setBtnHex}
            placeholder="#8b5cf6"
            placeholderTextColor="#6a6a6a"
            style={styles.hexInput}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            onSubmitEditing={() => commitHex(btnHex, (c) => setTheme({ buttonColor: c }))}
          />
          <Pressable
            onPress={() => commitHex(btnHex, (c) => setTheme({ buttonColor: c }))}
            style={[styles.hexBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.hexBtnText}>Apply</Text>
          </Pressable>
        </View>
      </GlassView>

      <Text style={styles.label}>Home background</Text>
      <GlassView style={styles.card}>
        <Segmented<BackgroundType>
          options={[
            { id: 'gradient', label: 'Gradient' },
            { id: 'color', label: 'Solid' },
            { id: 'image', label: 'Photo' },
          ]}
          value={theme.background.type}
          onPick={(t) =>
            setBackground(t, t === 'gradient' ? 'midnight' : t === 'color' ? '#000000' : 'custom')
          }
        />
        {theme.background.type === 'gradient' && (
          <View style={styles.presetRow}>
            {Object.entries(GRADIENT_PRESETS).map(([id, p]) => (
              <Pressable
                key={id}
                onPress={() => {
                  setBackground('gradient', id);
                  void Haptics.selectionAsync();
                }}
                style={[
                  styles.preset,
                  { backgroundColor: p.colors[1] },
                  theme.background.value === id && { borderColor: theme.accent, borderWidth: 2 },
                ]}
              >
                <Text style={styles.presetName}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {theme.background.type === 'color' && (
          <View>
            <Swatches value={colorHex} onPick={(c) => setBackground('color', c)} />
            <View style={styles.hexRow}>
              <TextInput
                value={colorHex}
                onChangeText={setColorHex}
                placeholder="#000000"
                placeholderTextColor="#6a6a6a"
                style={styles.hexInput}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
                onSubmitEditing={() => commitHex(colorHex, (c) => setBackground('color', c))}
              />
              <Pressable
                onPress={() => commitHex(colorHex, (c) => setBackground('color', c))}
                style={[styles.hexBtn, { backgroundColor: theme.buttonColor }]}
              >
                <Text style={styles.hexBtnText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        )}
        {theme.background.type === 'image' && (
          <View style={styles.photoRow}>
            <Pressable onPress={pickImage} style={[styles.hexBtn, { backgroundColor: theme.buttonColor }]}>
              <Text style={styles.hexBtnText}>Choose photo</Text>
            </Pressable>
            <Pressable onPress={clearImage} style={styles.clearBtn}>
              <Text style={[styles.clearText, { color: theme.accent }]}>Remove</Text>
            </Pressable>
          </View>
        )}
      </GlassView>

      {backendOk === false && (
        <>
          <Text style={styles.label}>Connection</Text>
          <GlassView style={styles.card}>
            <View style={styles.connRow}>
              <View style={[styles.dot, { backgroundColor: '#f43f5e' }]} />
              <Text style={styles.connText}>Backend unreachable</Text>
            </View>
            <Text style={styles.hint}>
              Downloads need the DropWave server. Check your connection and try again.
            </Text>
          </GlassView>
        </>
      )}

      <Text style={[styles.foot, { color: '#6a6a6a' }]}>
        DropWave 1.0. Downloads are for tracks you have the right to keep.
      </Text>
      <View style={{ height: 140 }} />
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: '#b3b3b3', fontSize: 14, marginTop: 4, marginBottom: 16 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  card: { padding: 14 },
  hint: { color: '#b3b3b3', fontSize: 12, lineHeight: 17, marginTop: 10 },
  segWrap: { flexDirection: 'row', backgroundColor: '#1f1f1f', borderRadius: 20, padding: 4 },
  segBtn: { flex: 1, borderRadius: 16, paddingVertical: 10, alignItems: 'center' },
  segText: { color: '#b3b3b3', fontSize: 14, fontWeight: '600' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  swatchRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    margin: 5,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchRingActive: { borderColor: '#fff' },
  swatchDot: { width: 34, height: 34, borderRadius: 17 },
  hexRow: { flexDirection: 'row', marginTop: 12, alignItems: 'center' },
  hexInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    backgroundColor: '#1f1f1f',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
  },
  hexBtn: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  hexBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -5 },
  preset: {
    width: '31%',
    aspectRatio: 1.4,
    borderRadius: 12,
    margin: 5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  presetName: { color: '#fff', fontSize: 11, fontWeight: '700' },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  clearBtn: { padding: 10, marginLeft: 8 },
  clearText: { fontSize: 13, fontWeight: '600' },
  connRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  connText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  foot: { fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 17 },
});
