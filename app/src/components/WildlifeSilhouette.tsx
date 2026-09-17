import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { wildlifeOf } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';

/**
 * 荒野守護物種背影剪影（拆盒揭曉／NFT 揭曉的鞋子背景層）。
 * 四種都是「往光走去」的背面視角：亞洲象（大耳、尾）、玳瑁（甲殼、四鰭）、老虎（背紋、翹尾）、遠東豹（斷環斑、長尾）。
 * 幾何仿生設計，只用單色填色＋少量紋路描邊；viewBox 200×200，由外層決定尺寸與透明度。
 */
export function WildlifeSilhouette({ level, color, size = 320, opacity = 0.22 }: { level: ShoeLevel; color: string; size?: number; opacity?: number }) {
  const animal = wildlifeOf(level);
  if (!animal) return null;
  return (
    <View style={{ width: size, height: size, opacity }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`wild-silhouette-${animal.species}`}>
      <Svg width="100%" height="100%" viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        {animal.species === 'elephant' ? <Elephant color={color} /> : null}
        {animal.species === 'hawksbill' ? <Hawksbill color={color} /> : null}
        {animal.species === 'tiger' ? <Tiger color={color} /> : null}
        {animal.species === 'leopard' ? <Leopard color={color} /> : null}
      </Svg>
    </View>
  );
}

/** 亞洲象背影：圓背、兩片大耳外張、後腿兩柱、尾巴垂中 */
function Elephant({ color }: { color: string }) {
  return (
    <G fill={color}>
      {/* 耳 */}
      <Path d="M62 64 C40 54 22 70 26 96 C29 116 46 122 62 112 Z" />
      <Path d="M138 64 C160 54 178 70 174 96 C171 116 154 122 138 112 Z" />
      {/* 頭頂 */}
      <Path d="M70 70 C74 44 126 44 130 70 Z" />
      {/* 身體 */}
      <Path d="M56 84 C58 60 142 60 144 84 C150 110 146 140 140 156 L60 156 C54 140 50 110 56 84 Z" />
      {/* 後腿 */}
      <Path d="M64 150 H90 V186 C90 190 66 190 66 186 Z" />
      <Path d="M110 150 H136 V186 C136 190 110 190 110 186 Z" />
      {/* 尾 */}
      <Path d="M97 150 H103 L104 178 C104 184 96 184 96 178 Z" />
      <Circle cx="100" cy="184" r="4" />
    </G>
  );
}

/** 玳瑁背影：心形甲殼＋甲片線、四鰭外展、尾 */
function Hawksbill({ color }: { color: string }) {
  return (
    <G fill={color}>
      {/* 前鰭 */}
      <Path d="M62 78 C40 62 18 66 10 84 C22 86 44 92 68 96 Z" />
      <Path d="M138 78 C160 62 182 66 190 84 C178 86 156 92 132 96 Z" />
      {/* 頭 */}
      <Path d="M90 62 C90 48 110 48 110 62 L106 76 H94 Z" />
      {/* 甲殼 */}
      <Path d="M100 70 C134 70 152 96 148 128 C144 156 122 172 100 174 C78 172 56 156 52 128 C48 96 66 70 100 70 Z" />
      {/* 後鰭 */}
      <Path d="M70 158 C56 168 46 182 44 194 C60 188 76 178 86 168 Z" />
      <Path d="M130 158 C144 168 154 182 156 194 C140 188 124 178 114 168 Z" />
      {/* 尾 */}
      <Path d="M96 172 H104 L101 190 H99 Z" />
      {/* 甲片線（挖空） */}
      <G stroke="#070A16" strokeOpacity={0.55} strokeWidth={3} fill="none">
        <Path d="M100 76 V168 M62 108 L138 108 M64 140 L136 140" />
        <Path d="M76 84 L86 108 L76 140 M124 84 L114 108 L124 140" />
      </G>
    </G>
  );
}

/** 老虎背影：圓臀、寬背、兩耳、翹尾、四腿；背上虎紋挖空 */
function Tiger({ color }: { color: string }) {
  return (
    <G fill={color}>
      {/* 頭與耳 */}
      <Path d="M76 60 L70 42 L88 50 H112 L130 42 L124 60 C126 74 74 74 76 60 Z" />
      {/* 身體 */}
      <Path d="M62 90 C66 66 134 66 138 90 C146 112 144 142 138 160 H62 C56 142 54 112 62 90 Z" />
      {/* 腿 */}
      <Path d="M64 150 H84 V190 H66 Z" />
      <Path d="M116 150 H136 V190 H118 Z" />
      {/* 尾巴翹起 */}
      <Path d="M132 130 C160 122 172 96 166 70 C160 66 154 68 154 76 C158 96 148 112 128 118 Z" />
      {/* 虎紋 */}
      <G stroke="#070A16" strokeOpacity={0.6} strokeWidth={4} strokeLinecap="round" fill="none">
        <Path d="M70 92 C84 98 116 98 130 92 M68 108 C86 114 114 114 132 108 M70 124 C88 130 112 130 130 124 M76 140 C92 146 108 146 124 140" />
        <Path d="M158 78 L166 82 M154 92 L162 96 M146 106 L154 110" />
      </G>
    </G>
  );
}

/** 遠東豹背影：較瘦長的身體、長尾垂繞、斷環玫瑰斑挖空 */
function Leopard({ color }: { color: string }) {
  const rosettes = [
    [86, 92], [114, 90], [74, 112], [100, 110], [126, 112], [82, 134], [110, 132], [96, 152], [122, 150],
  ];
  return (
    <G fill={color}>
      {/* 頭與耳 */}
      <Path d="M80 62 L74 44 L90 52 H110 L126 44 L120 62 C122 74 78 74 80 62 Z" />
      {/* 身體（較窄） */}
      <Path d="M66 90 C70 68 130 68 134 90 C140 112 138 144 132 162 H68 C62 144 60 112 66 90 Z" />
      {/* 腿 */}
      <Path d="M70 154 H88 V192 H72 Z" />
      <Path d="M112 154 H130 V192 H114 Z" />
      {/* 長尾垂下再繞起 */}
      <Path d="M128 134 C150 140 160 160 156 184 C154 192 144 194 142 186 C146 168 138 152 122 146 Z" />
      {/* 斷環玫瑰斑 */}
      <G stroke="#070A16" strokeOpacity={0.6} strokeWidth={3} fill="none" strokeLinecap="round">
        {rosettes.map(([x, y]) => (
          <G key={`${x}-${y}`}>
            <Path d={`M${x - 6} ${y} A6 6 0 0 1 ${x} ${y - 6}`} />
            <Path d={`M${x + 6} ${y} A6 6 0 0 1 ${x} ${y + 6}`} />
          </G>
        ))}
      </G>
    </G>
  );
}
