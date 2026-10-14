import { Pressable as GesturePressable, type PressableProps } from 'react-native-gesture-handler';

/**
 * gesture-handler's Pressable, with `disabled` enforced here instead of by
 * the library.
 *
 * On the web build, a gesture-handler Pressable that is first drawn with
 * `disabled` can stay unresponsive after it becomes enabled: a quest's "−"
 * (disabled at 0) never worked again after "+", and buttons drawn while a
 * screen was busy ignored taps until a reload. So the library is always
 * handed an enabled button, and a disabled one simply has no handlers.
 * Screen readers still hear "disabled" through `accessibilityState`.
 *
 * Use this one wherever a button can be disabled.
 */
export function Pressable({ disabled, onPress, onPressIn, onLongPress, ...rest }: PressableProps) {
  const off = disabled === true;
  return (
    <GesturePressable
      {...rest}
      onPress={off ? undefined : onPress}
      onPressIn={off ? undefined : onPressIn}
      onLongPress={off ? undefined : onLongPress}
    />
  );
}
