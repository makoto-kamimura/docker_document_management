import { useEffect } from "react";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type ParamListBase,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text, TouchableOpacity, View } from "react-native";
import { isAuthenticated, setUnauthorizedHandler } from "./src/api/client";
import { NotificationBell } from "./src/components/NotificationBell";
import { onPushOpened } from "./src/push";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CameraScreen } from "./src/screens/CameraScreen";
import { DocumentListScreen } from "./src/screens/DocumentListScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { SearchScreen } from "./src/screens/SearchScreen";

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<ParamListBase>();

// トークン失効(401)時はスタックを破棄してログイン画面へ戻す（Web と同じ挙動）
setUnauthorizedHandler(() => {
  if (navigationRef.isReady()) {
    navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
  }
});

const headerRow = { flexDirection: "row", alignItems: "center", gap: 16 } as const;
const link = { color: "#2563eb", fontWeight: "600" } as const;

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
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Camera"
          component={CameraScreen}
          options={({ navigation }) => ({
            title: "撮影",
            headerBackVisible: false,
            headerRight: () => (
              <View style={headerRow}>
                <NotificationBell />
                <TouchableOpacity onPress={() => navigation.navigate("Documents")}>
                  <Text style={link}>一覧 ›</Text>
                </TouchableOpacity>
              </View>
            ),
          })}
        />
        <Stack.Screen
          name="Documents"
          component={DocumentListScreen}
          options={({ navigation }) => ({
            title: "ドキュメント",
            headerRight: () => (
              <View style={headerRow}>
                <NotificationBell />
                <TouchableOpacity onPress={() => navigation.navigate("Search")}>
                  <Text style={[link, { fontSize: 16 }]}>🔍 検索</Text>
                </TouchableOpacity>
              </View>
            ),
          })}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: "全文検索" }}
        />
        <Stack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{ title: "お知らせ" }}
        />
        <Stack.Screen
          name="Detail"
          component={DocumentDetailScreen}
          options={({ route }: any) => ({ title: route.params?.title ?? "詳細" })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
