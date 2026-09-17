import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { wildlifeOf } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';

/**
 * 荒野守護物種背影剪影（拆盒揭曉／NFT 揭曉的鞋子背景層）。
 * 亞洲象：正背面（兩片外張的扇形耳、圓背、四柱腿、尾）；玳瑁：由上／後方看的游姿（心形甲殼、鋸齒後緣、長前鰭）；
 * 老虎與遠東豹：背對觀者、回頭側望（圓臀、肩背、側臉、耳、尾）——回頭的側臉讓貓科最好辨認。
 * 單色填色＋深色紋路描邊（虎紋、斷環豹斑、甲片線、象耳摺）；viewBox 200×200，由外層決定尺寸與透明度。
 * 草稿以 SVG 檔在桌面預覽後移植；要換正式美術直接替換四個元件。
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

const INK = '#070A16';

/** 亞洲象正背面：扇形大耳（上角高過頭頂、下角收向肩）、頭頂圓弧、寬背、前腿露在後腿外側、尾與尾鬃 */
function Elephant({ color }: { color: string }) {
  return (
    <>
      <G fill={color}>
        <Path d="M86 66 C78 50 54 42 40 56 C26 72 26 100 44 114 C56 122 72 116 86 104 Z" />
        <Path d="M114 66 C122 50 146 42 160 56 C174 72 174 100 156 114 C144 122 128 116 114 104 Z" />
        <Path d="M80 100 C74 58 126 58 120 100 Z" />
        <Path d="M46 132 C48 100 72 88 100 88 C128 88 152 100 154 132 C156 146 154 160 150 170 L50 170 C46 160 44 146 46 132 Z" />
        <Path d="M40 132 H58 V180 C58 186 40 186 40 180 Z" />
        <Path d="M142 132 H160 V180 C160 186 142 186 142 180 Z" />
        <Path d="M56 156 H88 V188 C88 194 56 194 56 188 Z" />
        <Path d="M112 156 H144 V188 C144 194 112 194 112 188 Z" />
        <Path d="M97.5 150 H102.5 L102 176 C103 184 97 184 98 176 Z" />
        <Path d="M100 176 C106 178 106 190 100 192 C94 190 94 178 100 176 Z" />
      </G>
      <G stroke={INK} strokeOpacity={0.5} strokeWidth={2.5} fill="none" strokeLinecap="round">
        <Path d="M82 74 C66 66 48 72 42 90" />
        <Path d="M118 74 C134 66 152 72 158 90" />
        <Path d="M100 104 V148" />
        <Path d="M58 172 H88 M112 172 H142" />
        <Path d="M68 116 C84 110 116 110 132 116" />
      </G>
    </>
  );
}

/** 玳瑁（游離觀者）：長前鰭向後掃、鷹喙狀頭、心形甲殼與鋸齒後緣、小後鰭、短尾；甲片線描出中央五片與側列 */
function Hawksbill({ color }: { color: string }) {
  return (
    <>
      <G fill={color}>
        <Path d="M64 90 C50 76 30 62 12 60 C4 60 2 66 8 72 C24 86 44 100 66 108 Z" />
        <Path d="M136 90 C150 76 170 62 188 60 C196 60 198 66 192 72 C176 86 156 100 134 108 Z" />
        <Path d="M90 72 C86 56 92 44 100 40 C108 44 114 56 110 72 Z" />
        <Path d="M97 42 L100 34 L103 42 Z" />
        <Path d="M100 64 C138 64 158 92 152 130 C149 150 138 164 126 172 L120 178 L114 172 L108 180 L100 174 L92 180 L86 172 L80 178 L74 172 C62 164 51 150 48 130 C42 92 62 64 100 64 Z" />
        <Path d="M74 160 C60 168 50 182 52 194 C62 188 76 180 86 170 Z" />
        <Path d="M126 160 C140 168 150 182 148 194 C138 188 124 180 114 170 Z" />
        <Path d="M97 176 L103 176 L100 190 Z" />
      </G>
      <G stroke={INK} strokeOpacity={0.55} strokeWidth={2.5} fill="none" strokeLinejoin="round">
        <Path d="M100 70 V170" />
        <Path d="M84 78 C82 100 84 124 90 150 L100 158 L110 150 C116 124 118 100 116 78" />
        <Path d="M66 96 L84 92 M134 96 L116 92 M58 124 L86 118 M142 124 L114 118 M64 150 L92 140 M136 150 L108 140" />
        <Path d="M84 100 L116 100 M86 124 L114 124 M92 146 L108 146" />
        <Path d="M94 66 C96 60 104 60 106 66" />
      </G>
    </>
  );
}

/** 老虎背影回頭：肩窄臀圓、側臉朝右（吻部、眼）、兩耳、翹尾捲起；背上四道虎紋、尾環、額紋 */
function Tiger({ color }: { color: string }) {
  return (
    <>
      <G fill={color}>
        <Path d="M70 96 C74 86 126 86 130 96 C142 110 148 134 146 152 C144 166 138 172 134 174 L66 174 C62 172 56 166 54 152 C52 134 58 110 70 96 Z" />
        <Path d="M92 74 C94 90 118 90 122 74 L128 98 L88 98 Z" />
        <Path d="M90 66 C90 44 112 38 124 44 C134 48 140 58 138 66 L146 70 C154 72 156 82 148 84 L134 84 C126 86 114 88 106 84 C96 80 90 74 90 66 Z" />
        <Path d="M94 54 L92 34 L108 44 Z" />
        <Path d="M116 42 L124 26 L132 46 Z" />
        <Path d="M62 164 H86 V188 C86 194 62 194 62 188 Z" />
        <Path d="M114 164 H138 V188 C138 194 114 194 114 188 Z" />
        <Path d="M134 150 C158 146 174 128 174 106 C174 92 168 82 160 84 C156 90 164 96 164 106 C162 124 150 136 130 140 Z" />
      </G>
      <G stroke={INK} strokeOpacity={0.6} strokeWidth={3.5} fill="none" strokeLinecap="round">
        <Path d="M78 104 C90 110 110 110 122 104" />
        <Path d="M70 120 C88 128 112 128 130 120" />
        <Path d="M64 138 C86 146 114 146 136 138" />
        <Path d="M66 156 C86 164 114 164 134 156" />
        <Path d="M164 92 L172 96 M162 108 L170 112 M152 126 L160 130" />
        <Path d="M100 52 L104 60 M110 46 L112 54" />
      </G>
      <Circle cx="128" cy="62" r="1.8" fill={INK} />
    </>
  );
}

const ROSETTES: [number, number][] = [
  [88, 106], [112, 104], [78, 122], [100, 120], [124, 124], [86, 138], [112, 136], [96, 154], [122, 152], [78, 156], [40, 184], [52, 166],
];

/** 遠東豹背影回頭：身形較老虎窄、頭較小、圓耳、長尾垂下向外捲；斷環玫瑰斑散佈背部與尾 */
function Leopard({ color }: { color: string }) {
  return (
    <>
      <G fill={color}>
        <Path d="M76 100 C80 90 120 90 124 100 C136 114 140 138 138 156 C136 168 132 174 128 176 L72 176 C68 174 64 168 62 156 C60 138 64 114 76 100 Z" />
        <Path d="M94 80 C96 94 118 94 122 80 L126 102 L90 102 Z" />
        <Path d="M92 72 C92 54 108 48 118 52 C126 55 132 62 130 70 L138 73 C144 75 145 83 138 84 L126 84 C118 86 108 86 102 82 C96 78 92 76 92 72 Z" />
        <Path d="M96 60 C90 48 98 42 106 50 Z" />
        <Path d="M114 50 C116 38 126 40 124 52 Z" />
        <Path d="M70 166 H90 V192 C90 198 70 198 70 192 Z" />
        <Path d="M110 166 H130 V192 C130 198 110 198 110 192 Z" />
        <Path d="M68 150 C46 156 30 174 34 196 C35 201 43 201 43 196 C42 178 54 166 74 160 Z" />
      </G>
      <G stroke={INK} strokeOpacity={0.6} strokeWidth={2.5} fill="none" strokeLinecap="round">
        {ROSETTES.map(([x, y]) => (
          <G key={`${x}-${y}`}>
            <Path d={`M${x - 5} ${y} A5 5 0 0 1 ${x} ${y - 5}`} />
            <Path d={`M${x + 5} ${y} A5 5 0 0 1 ${x} ${y + 5}`} />
          </G>
        ))}
      </G>
      <Circle cx="124" cy="64" r="1.6" fill={INK} />
    </>
  );
}
