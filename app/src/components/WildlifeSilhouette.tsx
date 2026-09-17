import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { wildlifeOf } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';

/**
 * 荒野守護物種背影剪影（拆盒揭曉／NFT 揭曉的鞋子背景層）。
 * 亞洲象：側身行進（大耳、長鼻、圓背與粗腿）；玳瑁：由上／後方看的游姿（心形甲殼、鋸齒後緣、長前鰭）；
 * 老虎與遠東豹：奔躍側身，圓耳、前伸爪、長尾與虎斑／斷環豹紋；外圍為守護徽記。
 * 單色填色＋深色紋路描邊（虎紋、斷環豹斑、甲片線、象耳摺）；viewBox 200×200，由外層決定尺寸與透明度。
 * 草稿以 SVG 檔在桌面預覽後移植；要換正式美術直接替換四個元件。
 */
export function WildlifeSilhouette({ level, color, size = 320, opacity = 0.22 }: { level: ShoeLevel; color: string; size?: number; opacity?: number }) {
  const animal = wildlifeOf(level);
  if (!animal) return null;
  return (
    <View style={{ width: size, height: size, opacity }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`wild-silhouette-${animal.species}`}>
      <Svg width="100%" height="100%" viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        <G fill="none" stroke={color}>
          <Circle cx="100" cy="99" r="87" strokeWidth={0.8} strokeOpacity={0.35} />
          <Path d="M28 55 A84 84 0 0 1 67 20 M133 20 A84 84 0 0 1 172 55 M172 143 A84 84 0 0 1 133 178 M67 178 A84 84 0 0 1 28 143" strokeWidth={2.5} strokeOpacity={0.7} />
          <Path d="M100 7 l4 8 l-4 8 l-4 -8 Z M12 98 l5 -4 l5 4 l-5 4 Z M178 98 l5 -4 l5 4 l-5 4 Z" strokeWidth={1.5} />
        </G>
        <G stroke={color} strokeWidth={0.65} strokeLinejoin="round">
        {animal.species === 'elephant'  ? <Elephant color={color} /> : null}
        {animal.species === 'hawksbill' ? <Hawksbill color={color} /> : null}
        {animal.species === 'tiger' ? <Tiger color={color} /> : null}
        {animal.species === 'leopard' ? <Leopard color={color} /> : null}
        </G>
      </Svg>
    </View>
  );
}

const INK = '#070A16';

/** 亞洲象側身行進：大耳、長鼻、圓背和粗腿，縮小仍能辨識。 */
function Elephant({ color }: { color: string }) {
  return <>
    <G fill={color}>
      <Path d="M31 104 C21 70 40 47 79 49 C105 45 119 53 131 66 C151 55 172 66 175 84 L177 110 C178 132 167 154 155 149 C145 144 150 134 155 131 C161 125 161 109 157 102 L144 110 L137 135 L128 172 L111 172 L112 130 L95 130 L82 165 L66 165 L72 123 L55 122 L47 159 L30 159 L34 111 Z" />
      <Path d="M33 76 Q16 87 18 111 L13 119 L12 106 Q12 80 31 68 Z" />
      <Path d="M132 65 Q103 48 99 77 Q95 106 125 121 Q144 98 132 65 Z" fill={INK} fillOpacity={0.35} />
    </G>
    <G fill="none" stroke={INK} strokeOpacity={0.65} strokeWidth={2.5} strokeLinecap="round">
      <Path d="M127 70 Q111 63 108 80 Q107 97 124 110 M45 80 Q62 65 86 70 M42 145 H49 M113 158 H128" />
    </G>
    <Circle cx="156" cy="82" r="2.5" fill={INK} />
  </>;
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

/** 奔躍的大貓：圓耳、低肩、前伸爪與長尾；虎斑／豹斑和姿態分別識別。 */
function Cat({ color, leopard = false }: { color: string; leopard?: boolean }) {
  return <>
    <G fill={color}>
      <Path d={leopard
        ? 'M38 106 Q35 81 65 82 L120 70 Q141 63 154 79 L165 86 L182 89 L184 101 L169 110 L149 103 L139 117 L166 138 L161 151 L128 128 L117 113 L89 121 L61 148 L40 149 L41 139 L64 131 L72 110 L49 119 L29 135 L18 132 L34 114 Z'
        : 'M35 106 Q31 74 63 72 L116 66 Q137 61 153 78 L167 85 L184 90 L184 104 L167 113 L147 105 L136 115 L169 126 L169 140 L130 135 L114 113 L83 117 L69 142 L44 155 L32 148 L55 131 L60 113 L44 120 L28 140 L14 135 L29 112 Z'} />
      <Circle cx="143" cy="69" r={leopard ? 7 : 9} />
      <Circle cx="160" cy="77" r={leopard ? 6 : 7} />
      <Path d={leopard ? 'M41 92 Q11 80 14 53 Q15 36 33 39 Q21 44 23 57 Q27 75 48 81 Z' : 'M38 86 Q15 85 15 66 Q15 51 6 48 Q30 45 28 63 Q28 72 47 76 Z'} />
    </G>
    <Circle cx="169" cy="91" r="2" fill={INK} />
    <Path d="M177 103 L183 101 M156 103 L164 101" stroke={INK} strokeWidth={2} />
    {leopard ? <G stroke={INK} strokeWidth={2.4} strokeOpacity={0.75} fill="none">
      {[[55,92],[72,85],[88,96],[104,82],[119,91],[65,105],[108,106],[140,88]].map(([x,y]) => <Path key={`${x}-${y}`} d={`M${x-4} ${y+2} q-3 -7 4 -7 M${x+4} ${y-1} q3 7 -4 7`} />)}
      <Path d="M20 59 L27 57 M27 74 L32 68" />
    </G> : <G fill={INK} fillOpacity={0.72}>
      <Path d="M52 76 l10 -2 l-4 18 l-8 9 l4 -16 Z M76 72 l10 -1 l-4 18 l-8 10 l4 -18 Z M101 68 l10 -1 l-3 17 l-8 10 l3 -17 Z M119 70 l9 1 l2 13 l-8 11 l1 -14 Z M42 108 l12 -3 l-8 10 Z M82 110 l12 -3 l-6 9 Z M138 78 l6 -4 l6 13 l-6 4 Z" />
    </G>}
  </>;
}
function Tiger({ color }: { color: string }) { return <Cat color={color} />; }
function Leopard({ color }: { color: string }) { return <Cat color={color} leopard />; }
