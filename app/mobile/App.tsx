import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text, TouchableOpacity } from "react-native";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CameraScreen } from "./src/screens/CameraScreen";
import { DocumentListScreen } from "./src/screens/DocumentListScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { SearchScreen } from "./src/screens/SearchScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
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
              <TouchableOpacity onPress={() => navigation.navigate("Documents")}>
                <Text style={{ color: "#2563eb", fontWeight: "600" }}>一覧 ›</Text>
              </TouchableOpacity>
            ),
          })}
        />
        <Stack.Screen
          name="Documents"
          component={DocumentListScreen}
          options={({ navigation }) => ({
            title: "ドキュメント",
            headerRight: () => (
              <TouchableOpacity onPress={() => navigation.navigate("Search")}>
                <Text style={{ color: "#2563eb", fontWeight: "600", fontSize: 16 }}>🔍 検索</Text>
              </TouchableOpacity>
            ),
          })}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: "全文検索" }}
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
