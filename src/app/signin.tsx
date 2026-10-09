import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { Screen } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import {
  forgetAccount,
  listAccounts,
  signInWithGoogle,
  switchAccount,
  type Account,
} from '@/lib/auth';
import { feedback, playSound } from '@/lib/feedback';
import { supabaseConfigured } from '@/lib/supabase';

/**
 * Linking a Google account, and choosing between the ones already linked.
 *
 * Signing in is optional by design. The app was local-first before any of this
 * existed and still is: an account buys you the same progress on your phone
 * and in the browser, plus Calendar and Tasks. Refusing it costs nothing, so
 * "Keep it on this device" is a first-class choice rather than a dismissal.
 */
export default function SignInScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listAccounts().then(setAccounts);
  }, []);

  useEffect(refresh, [refresh]);

  const configured = supabaseConfigured();

  async function addAccount() {
    if (busy) return;
    playSound('tap');
    setBusy('new');
    setError(null);

    const result = await signInWithGoogle();

    if (result.ok) {
      feedback('complete', 'success');
      refresh();
      router.replace('/');
      return;
    }
    // Backing out of the Google page is not a failure worth shouting about.
    if (!result.cancelled) setError(result.error ?? 'Sign-in failed.');
    setBusy(null);
  }

  async function activate(account: Account) {
    if (busy) return;
    playSound('tap');
    setBusy(account.id);
    setError(null);

    const ok = await switchAccount(account.id);
    if (ok) {
      feedback('complete', 'success');
      router.replace('/');
      return;
    }
    // The stored token has expired; Google has to be asked again.
    setError(`${account.email} needs signing in again.`);
    setBusy(null);
  }

  async function remove(account: Account) {
    playSound('tap');
    await forgetAccount(account.id);
    refresh();
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="label" color={palette.accent} style={styles.kicker}>
          ◆ System access ◆
        </SystemText>
        <SystemText variant="hero" style={styles.title}>
          LINK ACCOUNT
        </SystemText>
        <SystemText variant="body" style={styles.sub}>
          Sign in with Google to carry one hunter&apos;s record between your phone and the browser.
          You can link more than one address and switch between them.
        </SystemText>

        {!configured ? (
          <Card tint={palette.negative} style={styles.block}>
            <SystemText variant="label" color={palette.negative}>
              Not available yet
            </SystemText>
            <SystemText variant="body" style={styles.blockBody}>
              The System has no account server configured, so sign-in is switched off. Everything
              else works — your progress is saved on this device.
            </SystemText>
          </Card>
        ) : null}

        {accounts.length > 0 ? (
          <Animated.View entering={FadeIn.duration(260)} style={styles.listBlock}>
            <SystemText variant="label" style={styles.sectionLabel}>
              Linked on this device
            </SystemText>
            {accounts.map((a, i) => (
              <Animated.View key={a.id} entering={FadeInDown.duration(260).delay(Math.min(300, i * 60))}>
                <AccountRow
                  account={a}
                  busy={busy === a.id}
                  disabled={busy !== null}
                  onUse={() => void activate(a)}
                  onForget={() => void remove(a)}
                />
              </Animated.View>
            ))}
          </Animated.View>
        ) : null}

        {error ? (
          <Animated.View entering={FadeIn.duration(220)}>
            <Card tint={palette.negative} style={styles.block}>
              <SystemText variant="label" color={palette.negative}>
                Sign-in failed
              </SystemText>
              <SystemText variant="body" style={styles.blockBody}>
                {error}
              </SystemText>
            </Card>
          </Animated.View>
        ) : null}

        <ActionButton
          label={accounts.length > 0 ? 'Add another Google account' : 'Continue with Google'}
          onPress={() => void addAccount()}
          disabled={!configured || busy !== null}
          busy={busy === 'new'}
          primary
        />

        <ActionButton
          label="Keep it on this device"
          onPress={() => {
            playSound('tap');
            router.replace('/');
          }}
          disabled={busy !== null}
        />

        <SystemText variant="meta" style={styles.fine}>
          The System asks for your calendar and tasks so the nightly briefing can plan around what
          is already in your day. It never reads your mail.
        </SystemText>
      </ScrollView>
    </Screen>
  );
}

/**
 * One linked account. Two separate pressables side by side — never one inside
 * the other, which react-native-web renders as a button inside a button.
 */
function AccountRow({
  account,
  busy,
  disabled,
  onUse,
  onForget,
}: {
  account: Account;
  busy: boolean;
  disabled: boolean;
  onUse: () => void;
  onForget: () => void;
}) {
  return (
    <Card raised style={styles.row} contentStyle={styles.rowInner}>
      <Pressable
        onPress={onUse}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Use ${account.email}`}
        accessibilityState={{ disabled, busy }}
        style={styles.rowMain}>
        <View style={styles.rowMainInner}>
          {account.avatarUrl ? (
            <Image source={{ uri: account.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <SystemText variant="label" color={palette.accent}>
                {(account.name || account.email || '?').slice(0, 1).toUpperCase()}
              </SystemText>
            </View>
          )}
          <View style={styles.rowText}>
            <SystemText variant="title" style={styles.rowName} numberOfLines={1}>
              {account.name}
            </SystemText>
            <SystemText variant="meta" style={styles.rowEmail} numberOfLines={1}>
              {account.email}
            </SystemText>
          </View>
          {busy ? <ActivityIndicator size="small" color={palette.accent} /> : null}
        </View>
      </Pressable>

      <Pressable
        onPress={onForget}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${account.email} from this device`}>
        <View style={styles.forget}>
          <SystemText variant="label" color={palette.textMuted} style={styles.forgetText}>
            ✕
          </SystemText>
        </View>
      </Pressable>
    </Card>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  busy?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}>
      <Animated.View
        style={[
          styles.action,
          primary ? styles.actionPrimary : styles.actionGhost,
          {
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: 110,
          },
        ]}>
        {busy ? <ActivityIndicator size="small" color={primary ? palette.bg : palette.text} /> : null}
        <SystemText variant="label" color={primary ? palette.bg : palette.text} style={styles.actionLabel}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2, gap: space.md },
  kicker: { fontSize: 10, letterSpacing: 3 },
  title: { fontSize: 32, marginTop: space.xs },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: space.sm },
  sectionLabel: { marginBottom: space.sm, marginLeft: 2, color: palette.textMuted },

  block: { marginBottom: space.xs },
  blockBody: { fontSize: 13, lineHeight: 18, marginTop: 4 },

  listBlock: { gap: space.sm, marginBottom: space.sm },
  row: { marginBottom: 0 },
  rowInner: { flexDirection: 'row', alignItems: 'center', padding: space.sm, gap: space.xs },
  rowMain: { flex: 1 },
  rowMainInner: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.surfaceRaised },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.4),
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15 },
  rowEmail: { fontSize: 11, marginTop: 1 },
  forget: { paddingHorizontal: space.md, paddingVertical: space.md },
  forgetText: { fontSize: 13 },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
  },
  actionGhost: { borderWidth: 1, borderColor: palette.borderStrong },
  actionPrimary: { backgroundColor: palette.accent },
  actionLabel: { fontSize: 11, letterSpacing: 2 },

  fine: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: space.sm },
});
