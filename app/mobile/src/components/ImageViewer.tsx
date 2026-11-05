import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const SPRING = { damping: 20, stiffness: 220 };

// ピンチで拡大・縮小、拡大中は1本指で移動、ダブルタップで 1倍 ↔ 2.5倍。
// 拡大は指の中心（ダブルタップは押した位置）を基準にする。
function ZoomableImage({ uri }: { uri: string }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startFx = useSharedValue(0);
  const startFy = useSharedValue(0);
  // 枠と、枠に収めた画像の大きさ（ワークレットから読む）
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  const fitW = useSharedValue(0);
  const fitH = useSharedValue(0);

  // ページが変わったら等倍に戻し、画像の大きさを取り直す
  useEffect(() => {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    setNatural(null);
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => alive && setNatural({ w, h }),
      () => alive && setNatural({ w: 1, h: Math.SQRT2 })
    );
    return () => {
      alive = false;
    };
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps

  let fit: { w: number; h: number } | null = null;
  if (box && natural) {
    const k = Math.min(box.w / natural.w, box.h / natural.h);
    fit = { w: natural.w * k, h: natural.h * k };
  }
  useEffect(() => {
    if (!box || !fit) return;
    boxW.value = box.w;
    boxH.value = box.h;
    fitW.value = fit.w;
    fitH.value = fit.h;
  }, [box?.w, box?.h, fit?.w, fit?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // 拡大した画像の端が枠の内側に入り込まないように移動量を制限する
  const clampX = (x: number, s: number) => {
    "worklet";
    const max = Math.max(0, (fitW.value * s - boxW.value) / 2);
    return Math.min(max, Math.max(-max, x));
  };
  const clampY = (y: number, s: number) => {
    "worklet";
    const max = Math.max(0, (fitH.value * s - boxH.value) / 2);
    return Math.min(max, Math.max(-max, y));
  };
  const settle = () => {
    "worklet";
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value));
    if (s <= 1.01) {
      scale.value = withSpring(1, SPRING);
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
      return;
    }
    scale.value = withSpring(s, SPRING);
    tx.value = withSpring(clampX(tx.value, s), SPRING);
    ty.value = withSpring(clampY(ty.value, s), SPRING);
  };

  const pinch = usePinchGesture({
    onActivate: (e) => {
      "worklet";
      startScale.value = scale.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
      startFx.value = e.focalX - boxW.value / 2;
      startFy.value = e.focalY - boxH.value / 2;
    },
    onUpdate: (e) => {
      "worklet";
      // 少しだけ範囲外まで動かせる（離すと戻る）
      const s = Math.min(MAX_SCALE * 1.3, Math.max(MIN_SCALE * 0.6, startScale.value * e.scale));
      const ratio = s / startScale.value;
      const fx = e.focalX - boxW.value / 2;
      const fy = e.focalY - boxH.value / 2;
      // 拡大を始めたときに指の下にあった点が、今の指の下に来るように動かす
      tx.value = fx - ratio * (startFx.value - startTx.value);
      ty.value = fy - ratio * (startFy.value - startTy.value);
      scale.value = s;
    },
    onDeactivate: () => {
      "worklet";
      settle();
    },
  });

  const pan = usePanGesture({
    maxPointers: 1,
    onActivate: () => {
      "worklet";
      startTx.value = tx.value;
      startTy.value = ty.value;
    },
    onUpdate: (e) => {
      "worklet";
      if (scale.value <= 1.01) return;
      tx.value = clampX(startTx.value + e.translationX, scale.value);
      ty.value = clampY(startTy.value + e.translationY, scale.value);
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      "worklet";
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      const fx = e.x - boxW.value / 2;
      const fy = e.y - boxH.value / 2;
      scale.value = withTiming(s);
      tx.value = withTiming(clampX((1 - s) * fx, s));
      ty.value = withTiming(clampY((1 - s) * fy, s));
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
  };

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.stage} onLayout={onLayout} collapsable={false}>
        {fit ? (
          <Animated.View style={[{ width: fit.w, height: fit.h }, animated]}>
            <Image source={{ uri }} style={styles.fill} resizeMode="contain" />
          </Animated.View>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// 書類画像の全画面表示（黒背景）。複数ページは下のページ送りで切り替える。
export function ImageViewer({
  visible,
  uri,
  loading,
  page,
  pageCount,
  onPage,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  loading: boolean;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Android の Modal は別ウィンドウなので、ジェスチャーのルートを置き直す */}
      <GestureHandlerRootView style={styles.root}>
        {uri && !loading ? <ZoomableImage uri={uri} /> : <ActivityIndicator style={styles.fill} color="#fff" />}

        <TouchableOpacity
          style={[styles.close, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={10}
          accessibilityLabel="閉じる"
        >
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          {pageCount > 1 && (
            <View style={styles.pager}>
              <TouchableOpacity
                style={styles.pagerBtn}
                disabled={page <= 0}
                onPress={() => onPage(page - 1)}
                accessibilityLabel="前のページ"
              >
                <Ionicons name="chevron-back" size={20} color={page <= 0 ? "rgba(255,255,255,0.3)" : "#fff"} />
              </TouchableOpacity>
              <Text style={styles.pagerLabel}>{page + 1} / {pageCount}</Text>
              <TouchableOpacity
                style={styles.pagerBtn}
                disabled={page >= pageCount - 1}
                onPress={() => onPage(page + 1)}
                accessibilityLabel="次のページ"
              >
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={page >= pageCount - 1 ? "rgba(255,255,255,0.3)" : "#fff"}
                />
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.hint}>ピンチで拡大・ダブルタップで切り替え</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  close: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: 10 },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    paddingHorizontal: 4,
  },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 9 },
  pagerLabel: { color: "#fff", fontWeight: "600", fontSize: 15, minWidth: 56, textAlign: "center" },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
});
