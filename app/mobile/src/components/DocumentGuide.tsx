import { useState } from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";

const A4_RATIO = Math.SQRT2; // 縦 / 横（A4 縦置き）
const CORNER = 28;
const THICK = 4;
const DIM = "rgba(0,0,0,0.38)";

// カメラの上に重ねる「書類を合わせる枠」。枠の外を暗くし、四隅に L 字を描く。
// 撮った写真は切り取らない（サーバーの輪郭検出・台形補正は余白つきの写真で一番よく働く）。
export function DocumentGuide() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  let frame = null;
  if (size) {
    // 幅の 88% か、高さの 82% に収まる大きさの小さいほう
    const fw = Math.min(size.w * 0.88, (size.h * 0.82) / A4_RATIO);
    const fh = fw * A4_RATIO;
    const left = (size.w - fw) / 2;
    const top = (size.h - fh) / 2;
    frame = { fw, fh, left, top };
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {frame && (
        <>
          {/* 枠の外を暗くする（上・下・左・右） */}
          <View style={[styles.dim, { top: 0, left: 0, right: 0, height: frame.top }]} />
          <View style={[styles.dim, { top: frame.top + frame.fh, left: 0, right: 0, bottom: 0 }]} />
          <View style={[styles.dim, { top: frame.top, left: 0, width: frame.left, height: frame.fh }]} />
          <View style={[styles.dim, { top: frame.top, right: 0, width: frame.left, height: frame.fh }]} />

          <View style={[styles.frame, { top: frame.top, left: frame.left, width: frame.fw, height: frame.fh }]}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>

          <View style={[styles.hintWrap, { top: Math.max(frame.top - 34, 6) }]}>
            <Text style={styles.hint}>書類を枠に合わせて撮影</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  frame: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.55)",
  },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: "#fff" },
  tl: { top: -THICK / 2, left: -THICK / 2, borderTopWidth: THICK, borderLeftWidth: THICK, borderTopLeftRadius: 6 },
  tr: { top: -THICK / 2, right: -THICK / 2, borderTopWidth: THICK, borderRightWidth: THICK, borderTopRightRadius: 6 },
  bl: { bottom: -THICK / 2, left: -THICK / 2, borderBottomWidth: THICK, borderLeftWidth: THICK, borderBottomLeftRadius: 6 },
  br: { bottom: -THICK / 2, right: -THICK / 2, borderBottomWidth: THICK, borderRightWidth: THICK, borderBottomRightRadius: 6 },
  hintWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  hint: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
});
