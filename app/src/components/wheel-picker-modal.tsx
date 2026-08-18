import { Picker } from '@react-native-picker/picker';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { colors, pressFeedback } from '@/src/theme/tokens';
import { HapticPressable as Pressable } from './haptics';

const PICKER_HEIGHT = 216;

export type WheelColumn = {
  values: string[];
  initialIndex: number;
  prefix?: string;
  suffix?: string;
};

export function WheelPickerModal({
  visible,
  title,
  columns,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  columns: WheelColumn[];
  onCancel: () => void;
  onConfirm: (indexes: number[]) => void;
}) {
  const [indexes, setIndexes] = useState(() => columns.map((column) => column.initialIndex));

  return <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.modalRoot}>
      <Pressable accessibilityLabel="피커 닫기" onPress={onCancel} style={styles.backdrop} />
      <GlassView glassEffectStyle="regular" isInteractive style={styles.glassSheet}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onCancel} style={({ pressed }) => pressed && styles.pressed}><Text style={styles.cancel}>취소</Text></Pressable>
          <Text style={styles.title}>{title}</Text>
          <Pressable accessibilityLabel="완료" accessibilityRole="button" hitSlop={12} onPress={() => onConfirm(indexes)} style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}><SymbolView fallback={<Text style={styles.checkFallback}>✓</Text>} name="checkmark" size={22} tintColor={colors.primary} weight="semibold"/></Pressable>
        </View>
        <View style={styles.pickers}>{columns.map((column, columnIndex) => <NativePickerColumn
          key={`${title}-${columnIndex}`}
          column={column}
          index={indexes[columnIndex]}
          onChange={(index) => setIndexes((current) => current.map((value, indexAt) => indexAt === columnIndex ? index : value))}
        />)}</View>
      </GlassView>
    </View>
  </Modal>;
}

function NativePickerColumn({ column, index, onChange }: { column: WheelColumn; index: number; onChange: (index: number) => void }) {
  return <Picker
    onValueChange={(value) => {
      const nextIndex = column.values.indexOf(String(value));
      if (nextIndex >= 0) onChange(nextIndex);
    }}
    selectedValue={column.values[index]}
    style={styles.nativePicker}
  >{column.values.map((value) => <Picker.Item key={value} label={`${column.prefix ?? ''}${value}${column.suffix ?? ''}`} value={value}/>)}
  </Picker>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  pressed: pressFeedback,
  backdrop: { ...StyleSheet.absoluteFillObject },
  glassSheet: { height: 326, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  cancel: { color: '#777777', fontSize: 15, fontWeight: '600' }, title: { color: '#1C1A1A', fontSize: 16, fontWeight: '800' }, doneButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, checkFallback: { color: colors.primary, fontSize: 22, fontWeight: '700' },
  pickers: { height: PICKER_HEIGHT, flexDirection: 'row', overflow: 'hidden' },
  nativePicker: { flex: 1, height: PICKER_HEIGHT },
});
