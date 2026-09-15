import { Feather } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, glowStyle, layout, typography } from "@/theme";
import { EvolutionReveal } from "@/components/EvolutionReveal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ArenaScreen } from "@/screens/tabs/ArenaScreen";
import { GearScreen } from "@/screens/tabs/GearScreen";
import { HomeScreen } from "@/screens/tabs/HomeScreen";
import { ProfileScreen } from "@/screens/tabs/ProfileScreen";

import type { TabParamList } from "./types";
import { useT } from "@/i18n";

const Tab = createBottomTabNavigator<TabParamList>();

// 16.1：單一 rounded stroke icon family（Feather，2dp）；24dp 用於 navigation
const icons: Record<
  keyof TabParamList,
  React.ComponentProps<typeof Feather>["name"]
> = {
  Home: "activity",
  Gear: "layers",
  Arena: "award",
  Profile: "user",
};

function TabIcon({
  name,
  focused,
}: {
  name: keyof TabParamList;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconWrap, focused && glowStyle("small", color.mint)]}>
      <Feather
        name={icons[name]}
        size={24}
        color={focused ? color.mint : color.textMuted}
      />
    </View>
  );
}

/**
 * 固定四分頁 bottom navigation（Style 2.2）。
 * icon 與 label 同時顯示；active 為 mint 文字＋低強度 glow，inactive 為 textMuted。
 */
export function MainTabs() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <>
      <OfflineBanner />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarShowLabel: true,
          tabBarActiveTintColor: color.mint,
          tabBarInactiveTintColor: color.textMuted,
          tabBarLabelStyle: { ...typography.label, textTransform: "none" },
          tabBarStyle: {
            backgroundColor: color.surface,
            borderTopColor: color.borderSubtle,
            height: layout.bottomNavHeight + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 8,
          },
          tabBarIcon: ({ focused }) => (
            <TabIcon name={route.name} focused={focused} />
          ),
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: t("nav.home") }} />
        <Tab.Screen name="Gear" component={GearScreen} options={{ title: t("nav.gear") }} />
        <Tab.Screen name="Arena" component={ArenaScreen} options={{ title: t("nav.arena") }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: t("nav.profile") }} />
      </Tab.Navigator>
      <EvolutionReveal />
    </>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
