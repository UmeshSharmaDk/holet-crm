import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { Platform, RefreshControl, ScrollViewProps } from "react-native";
import { ScrollView, usePageRefresh } from "./RefreshablePages";
import Colors from "@/constants/colors";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  const refresh = usePageRefresh();
  if (Platform.OS === "web") {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
      alwaysBounceVertical
      refreshControl={props.refreshControl ?? <RefreshControl {...refresh} tintColor={Colors.light.accent} />}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
