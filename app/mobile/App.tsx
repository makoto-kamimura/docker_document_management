import { useEffect } from "react";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useFocusEffect,
  type ParamListBase,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isAuthenticated, setUnauthorizedHandler } from "./src/api/client";
import { onPushOpened } from "./src/push";
import { colors } from "./src/theme";
import { UnreadProvider, useUnread } from "./src/unread";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CameraScreen } from "./src/screens/CameraScreen";
import { DocumentListScreen } from "./src/screens/DocumentListScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { SearchScreen } from "./src/screens/SearchScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef<ParamListBase>();

// トークン失効(401)時はスタックを破棄してログイン画面へ戻す（Web と同じ挙動）
setUnauthorizedHandler(() => {
  if (navigationRef.isReady()) {
    navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
  }
});

type IconName = keyof typeof Ionicons.glyphMap;
const tabIcon = (name: IconName) => ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
  <Ionicons name={focused ? name : (`${name}-outline` as IconName)} size={size} color={color} />
);

// ログイン後のメイン画面: 撮影 / 書類 / 検索 / お知らせ の下タブ
function MainTabs() {
  const { unread, refresh } = useUnread();
  // ログイン直後と、詳細から戻ったときに未読件数を取り直す
  useFocusEffect(refresh);

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerTitleAlign: "left",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontSize: 22, fontWeight: "700", color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tab.Screen
        name="Camera"
        component={CameraScreen}
        options={{ title: "撮影", tabBarIcon: tabIcon("camera") }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentListScreen}
        options={{ title: "書類", tabBarIcon: tabIcon("document-text") }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: "検索", tabBarIcon: tabIcon("search") }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: "お知らせ",
          tabBarIcon: tabIcon("notifications"),
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  // プッシュ通知のタップで書類を開く（未ログインならログイン後に開く）
  useEffect(
    () =>
      onPushOpened((id) => {
        if (!isAuthenticated() || !navigationRef.isReady()) return false;
        navigationRef.navigate("Detail", { id });
        return true;
      }),
    []
  );

  return (
    <SafeAreaProvider>
      <UnreadProvider>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator initialRouteName="Login">
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="Detail"
              component={DocumentDetailScreen}
              options={{
                title: "",
                headerShadowVisible: false,
                headerBackButtonDisplayMode: "minimal",
                headerTintColor: colors.primary,
                headerStyle: { backgroundColor: colors.bg },
                contentStyle: { backgroundColor: colors.bg },
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </UnreadProvider>
    </SafeAreaProvider>
  );
}
