import { View, type ViewProps } from 'react-native';

/**
 * Marks something to rise and brighten as it scrolls into view, and sink back
 * as it leaves. The motion itself is the CSS in src/app/+html.tsx: this only
 * tags the element, so no code runs per frame. `late` holds it back a beat, for
 * the second item in a row. Does nothing on a phone app, only on the web.
 */
export function Reveal({ late, ...props }: ViewProps & { late?: boolean }) {
  return <View {...props} {...revealProps(late ? '1' : '')} />;
}

/** The same tag, for a component that already has its own root view. */
export function revealProps(kind: '' | '1' | 'head' = ''): object {
  return { dataSet: { reveal: kind } };
}
