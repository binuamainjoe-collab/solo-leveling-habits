import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { Screen } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import {
  completeness,
  DAY_LABEL,
  DOCUMENT_TYPES,
  LIFE_SECTIONS,
  MAX_DOCUMENT_BYTES,
  valueOf,
  type LifeProfile,
  type ProfileDocument,
} from '@/data/lifeProfile';
import { currentSession, type Account, listAccounts } from '@/lib/auth';
import { openAssistant } from '@/lib/assistantBus';
import { playSound, feedback } from '@/lib/feedback';
import { liveSupported } from '@/lib/live';
import { fetchLifeProfile, forgetDocument, readDocumentFile, saveProfileFields, type ProfileFieldWrite } from '@/lib/profile';
import { useProgress } from '@/store/progress';

/**
 * Everything The System knows about the Player as a person.
 *
 * The System fills this itself: it interviews the Player (typed or by
 * voice), keeps it current from what they say, and reads the documents they
 * hand it, such as a class timetable. The Player can correct any field by
 * hand. Every part of The System reads it: the assistant, the live call,
 * the planner and the quest proposals.
 */
export default function ProfileScreen() {
  const { state } = useProgress();
  const [profile, setProfile] = useState<LifeProfile>({});
  const [documents, setDocuments] = useState<ProfileDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [editing, setEditing] = useState<{ section: string; field: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  /** What the last document did, with how to take back its profile changes. */
  const [lastRead, setLastRead] = useState<{ doc: ProfileDocument; changed: string[]; undo: ProfileFieldWrite[]; undone?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [res, session, accounts] = await Promise.all([fetchLifeProfile(), currentSession().catch(() => null), listAccounts()]);
      if (!alive) return;
      if (res.ok && res.data) {
        setProfile(res.data.profile);
        setDocuments(res.data.documents);
      } else {
        setError(res.error ?? 'The System could not load your profile.');
      }
      const id = session?.user?.id;
      setAccount(accounts.find((a) => a.id === id) ?? null);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pct = completeness(profile);
  const name = valueOf(profile, 'basics', 'name') || state.profile?.name || 'Player';

  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    const res = await saveProfileFields([{ section: editing.section, field: editing.field, value: editing.text }]);
    setSaving(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Could not save that.');
      return;
    }
    playSound('tap');
    setProfile(res.data);
    setEditing(null);
  }

  async function addDocument() {
    if (reading) return;
    playSound('tap');
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > MAX_DOCUMENT_BYTES) {
      setError('That file is too big. Keep it under 4 MB — a photo or a one-page PDF is plenty.');
      return;
    }
    const mimeType = file.mimeType ?? (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    setReading(true);
    const res = await readDocumentFile({ uri: file.uri, name: file.name, mimeType, today: state.date });
    if (!res.ok || !res.data) {
      setReading(false);
      setError(res.error ?? 'The System could not read that document.');
      return;
    }
    const { document, facts } = res.data;

    // What the document says about the Player goes straight into the
    // profile — with Undo, since The System read it, not the Player.
    const undo = facts.map((f) => ({ section: f.section, field: f.field, value: valueOf(profile, f.section, f.field) }));
    const changes = facts.filter((f) => valueOf(profile, f.section, f.field) !== f.value);
    let next = profile;
    if (changes.length) {
      const saved = await saveProfileFields(changes);
      if (saved.ok && saved.data) next = saved.data;
    }
    setReading(false);
    feedback('complete', 'success');
    setProfile(next);
    setDocuments((d) => [document, ...d]);
    setLastRead({
      doc: document,
      changed: changes.map((c) => {
        const field = LIFE_SECTIONS.find((s) => s.key === c.section)?.fields.find((f) => f.key === c.field);
        return `${field?.label ?? c.field}: ${c.value}`;
      }),
      undo: undo.filter((u) => changes.some((c) => c.section === u.section && c.field === u.field)),
    });
  }

  async function undoLastRead() {
    if (!lastRead || lastRead.undone) return;
    playSound('tap');
    const res = await saveProfileFields(lastRead.undo);
    if (res.ok && res.data) setProfile(res.data);
    setLastRead({ ...lastRead, undone: true });
  }

  async function removeDocument(doc: ProfileDocument) {
    playSound('tap');
    const res = await forgetDocument(doc.id);
    if (!res.ok) {
      setError(res.error ?? 'Could not remove that document.');
      return;
    }
    setDocuments((d) => d.filter((x) => x.id !== doc.id));
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <View style={styles.back}>
            <Icon name="back" size={icon.bar} color={palette.accent} />
          </View>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="hero" style={styles.title}>
          Profile
        </SystemText>

        {/* Who this is: the Google account the profile belongs to. */}
        <Card style={styles.block} contentStyle={styles.accountRow}>
          {account?.avatarUrl ? (
            <Image source={{ uri: account.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <SystemText variant="title" color={palette.accent}>
                {name.slice(0, 1).toUpperCase()}
              </SystemText>
            </View>
          )}
          <View style={styles.accountText}>
            <SystemText variant="title" numberOfLines={1}>
              {account?.name || name}
            </SystemText>
            <SystemText variant="meta" numberOfLines={1}>
              {account ? account.email : 'Not signed in · kept on this server for The System'}
            </SystemText>
          </View>
          {!account ? (
            <Pressable onPress={() => router.push('/signin')} accessibilityRole="button" accessibilityLabel="Sign in with Google">
              <View style={styles.smallButton}>
                <SystemText variant="meta" color={palette.text} style={styles.bold}>
                  Sign in
                </SystemText>
              </View>
            </Pressable>
          ) : null}
        </Card>

        {/* How well The System knows them, and the ways to teach it. */}
        <Card style={styles.block} contentStyle={styles.knowBlock}>
          <View style={styles.knowHead}>
            <SystemText variant="body" style={styles.bold}>
              The System knows {pct}% of your life
            </SystemText>
          </View>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.max(2, pct)}%` }]} />
          </View>
          <ActionRow
            iconName="live"
            label="Let The System interview me"
            hint="It asks one question at a time and fills this in."
            onPress={() => openAssistant('interview')}
            primary
          />
          {liveSupported() ? (
            <ActionRow
              iconName="mic"
              label="Interview me by voice"
              hint="A live call: just talk."
              onPress={() => openAssistant('live-interview')}
            />
          ) : null}
          <ActionRow
            iconName="check"
            label="Suggest quests from my profile"
            hint="A new quest board for your life. Nothing changes until you accept."
            onPress={() => openAssistant('board')}
          />
          <ActionRow
            iconName="external"
            label={reading ? 'Reading…' : 'Add a timetable or document'}
            hint="A PDF or a photo: class timetable, exam dates, work rota."
            onPress={() => void addDocument()}
            busy={reading}
          />
        </Card>

        {error ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <Card tint={palette.negative} style={styles.block}>
              <SystemText variant="body" color={palette.negative}>
                {error}
              </SystemText>
            </Card>
          </Animated.View>
        ) : null}

        {lastRead ? (
          <Animated.View entering={FadeIn.duration(220)}>
            <Card style={styles.block} contentStyle={styles.readBlock}>
              <SystemText variant="meta" color={palette.positive} style={styles.bold}>
                Read: {lastRead.doc.name}
              </SystemText>
              <SystemText variant="body">
                {[
                  lastRead.doc.weekly.length ? `${lastRead.doc.weekly.length} weekly blocks` : '',
                  lastRead.doc.dates.length ? `${lastRead.doc.dates.length} dates` : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || lastRead.doc.summary}
              </SystemText>
              {lastRead.changed.map((line) => (
                <SystemText key={line} variant="meta" style={lastRead.undone ? styles.struck : undefined}>
                  Profile · {line}
                </SystemText>
              ))}
              {lastRead.changed.length && !lastRead.undone ? (
                <Pressable onPress={() => void undoLastRead()} accessibilityRole="button" accessibilityLabel="Undo the profile changes from this document">
                  <View style={styles.smallButton}>
                    <Icon name="undo" size={icon.small} color={palette.text} />
                    <SystemText variant="meta" color={palette.text} style={styles.bold}>
                      Undo
                    </SystemText>
                  </View>
                </Pressable>
              ) : null}
            </Card>
          </Animated.View>
        ) : null}

        {!loaded ? <ActivityIndicator color={palette.accent} style={styles.loading} /> : null}

        {documents.length > 0 ? (
          <>
            <SystemText variant="label" style={styles.sectionLabel}>
              Documents
            </SystemText>
            <Card style={styles.block} contentStyle={styles.list}>
              {documents.map((doc, i) => (
                <View key={doc.id} style={[styles.docRow, i > 0 && styles.divider]}>
                  <View style={styles.flex}>
                    <SystemText variant="body" style={styles.bold} numberOfLines={1}>
                      {doc.name}
                    </SystemText>
                    {doc.summary ? (
                      <SystemText variant="meta" numberOfLines={2}>
                        {doc.summary}
                      </SystemText>
                    ) : null}
                    {doc.weekly.length ? (
                      <SystemText variant="meta" color={palette.textFaint} numberOfLines={2}>
                        {weekSummary(doc)}
                      </SystemText>
                    ) : null}
                  </View>
                  <Pressable onPress={() => void removeDocument(doc)} accessibilityRole="button" accessibilityLabel={`Remove ${doc.name}`}>
                    <View style={styles.iconButton}>
                      <Icon name="close" size={icon.small} color={palette.textMuted} />
                    </View>
                  </Pressable>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {LIFE_SECTIONS.map((section) => (
          <View key={section.key}>
            <SystemText variant="label" style={styles.sectionLabel}>
              {section.label}
            </SystemText>
            <Card style={styles.block} contentStyle={styles.list}>
              {section.fields.map((field, i) => {
                const value = valueOf(profile, section.key, field.key);
                const isEditing = editing?.section === section.key && editing.field === field.key;
                return (
                  <View key={field.key} style={[styles.fieldRow, i > 0 && styles.divider]}>
                    {isEditing ? (
                      <View style={styles.editBlock}>
                        <SystemText variant="meta">{field.label}</SystemText>
                        <TextInput
                          value={editing.text}
                          onChangeText={(text) => setEditing({ ...editing, text })}
                          placeholder={field.ask}
                          placeholderTextColor={palette.textFaint}
                          style={styles.input}
                          multiline
                          autoFocus
                        />
                        <View style={styles.editButtons}>
                          <Pressable onPress={() => void saveEdit()} accessibilityRole="button" accessibilityLabel={`Save ${field.label}`}>
                            <View style={[styles.smallButton, styles.smallPrimary]}>
                              <SystemText variant="meta" color={palette.bg} style={styles.bold}>
                                {saving ? 'Saving…' : 'Save'}
                              </SystemText>
                            </View>
                          </Pressable>
                          <Pressable onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Cancel">
                            <View style={styles.smallButton}>
                              <SystemText variant="meta" color={palette.text} style={styles.bold}>
                                Cancel
                              </SystemText>
                            </View>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setEditing({ section: section.key, field: field.key, text: value })}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${field.label}`}>
                        <View style={styles.fieldInner}>
                          <SystemText variant="meta">{field.label}</SystemText>
                          <SystemText variant="body" color={value ? palette.text : palette.textFaint}>
                            {value || 'Not set'}
                          </SystemText>
                        </View>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function ActionRow({
  iconName,
  label,
  hint,
  onPress,
  primary,
  busy,
}: {
  iconName: 'live' | 'mic' | 'check' | 'external';
  label: string;
  hint: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (busy) return;
        playSound('tap');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={styles.actionRow}>
        <View style={[styles.actionIcon, primary && styles.actionIconPrimary]}>
          {busy ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Icon name={iconName} size={icon.body} color={primary ? palette.bg : palette.accent} />
          )}
        </View>
        <View style={styles.flex}>
          <SystemText variant="body" style={styles.bold}>
            {label}
          </SystemText>
          <SystemText variant="meta">{hint}</SystemText>
        </View>
        <Icon name="chevron" size={icon.small} color={palette.textFaint} />
      </View>
    </Pressable>
  );
}

/** "Mon 09:00 Statistics · Tue 10:00 Algebra · +6 more" */
function weekSummary(doc: ProfileDocument): string {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const blocks = [...doc.weekly].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day) || a.start.localeCompare(b.start));
  const shown = blocks.slice(0, 3).map((b) => `${DAY_LABEL[b.day] ?? b.day} ${b.start} ${b.title}`);
  return blocks.length > 3 ? `${shown.join(' · ')} · +${blocks.length - 3} more` : shown.join(' · ');
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  back: { width: HIT, height: HIT, alignItems: 'flex-start', justifyContent: 'center' },
  scroll: { paddingBottom: space.xxl * 2, gap: space.sm },
  title: { marginBottom: space.sm },
  block: { marginBottom: space.xs },
  sectionLabel: { marginTop: space.md, marginBottom: space.xs, marginLeft: 2, color: palette.textMuted },
  loading: { marginVertical: space.lg },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  accountText: { flex: 1, minWidth: 0, gap: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: alpha(palette.accent, 0.4) },

  knowBlock: { padding: space.md, gap: space.sm },
  knowHead: { flexDirection: 'row', justifyContent: 'space-between' },
  meter: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceRaised, overflow: 'hidden', marginBottom: space.xs },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: palette.accent },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: HIT + 8, paddingVertical: space.xs },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.accent, 0.14),
  },
  actionIconPrimary: { backgroundColor: palette.accent },

  readBlock: { padding: space.md, gap: 4 },
  struck: { textDecorationLine: 'line-through', color: palette.textFaint },

  list: { paddingHorizontal: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.borderStrong },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  fieldRow: { paddingVertical: space.xs },
  fieldInner: { minHeight: HIT, justifyContent: 'center', gap: 2, paddingVertical: space.xs },
  editBlock: { gap: space.xs, paddingVertical: space.sm },
  input: {
    minHeight: HIT,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceRaised,
    color: palette.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 17,
  },
  editButtons: { flexDirection: 'row', gap: space.sm },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: HIT,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceRaised,
    alignSelf: 'flex-start',
  },
  smallPrimary: { backgroundColor: palette.accent },
  iconButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
});
