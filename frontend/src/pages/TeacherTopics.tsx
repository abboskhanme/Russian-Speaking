import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadToPresigned } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Topic } from "../lib/types";
import {
  Card,
  Button,
  Icon,
  PageHead,
  Loading,
  EmptyState,
  iconBtn,
  inp,
} from "../components/govori";
import { useConfirm } from "../components/ConfirmDialog";

/** Stable hue per topic so each card gets a distinct gradient icon. */
function topicHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return [47, 152, 248, 305, 80, 28][h % 6];
}

export function TeacherTopics() {
  const { t } = useI18n();
  const ask = useConfirm();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["topics-managed"],
    queryFn: async () => (await api.get<Topic[]>("/topics")).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["topics-managed"] });
    qc.invalidateQueries({ queryKey: ["topics"] });
    qc.invalidateQueries({ queryKey: ["topic-images"] });
  };

  const add = useMutation({
    mutationFn: async (n: string) => (await api.post<Topic>("/topics", { name: n })).data,
    onSuccess: () => {
      setName("");
      setAdding(false);
      invalidate();
    },
  });

  return (
    <div className="focus-wrap anim-fade-up">
      <PageHead
        title={t("topicsTitle")}
        sub={t("topicsHint")}
        action={
          <Button icon="plus" onClick={() => setAdding((a) => !a)}>
            {t("addTopic")}
          </Button>
        }
      />

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate(name.trim());
          }}
          className="row gap-2"
          style={{ marginBottom: 18, maxWidth: 480 }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("topicNamePh")}
            style={{ ...inp, flex: 1 }}
          />
          <Button type="submit" disabled={!name.trim() || add.isPending}>
            {t("save")}
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            {t("cancel")}
          </Button>
        </form>
      )}

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noTopics")} />
      ) : (
        <div className="g3">
          {data.map((topic) => (
            <TopicCard key={topic.id} topic={topic} onChanged={invalidate} ask={ask} />
          ))}
        </div>
      )}
    </div>
  );
}

function TopicCard({
  topic,
  onChanged,
  ask,
}: {
  topic: Topic;
  onChanged: () => void;
  ask: (o: { message: string; confirmText?: string; destructive?: boolean }) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hue = topicHue(topic.id);

  const rename = useMutation({
    mutationFn: async () => api.patch(`/topics/${topic.id}`, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  const removeTopic = useMutation({
    mutationFn: async () => api.delete(`/topics/${topic.id}`),
    onSuccess: onChanged,
  });

  const removeImage = useMutation({
    mutationFn: async (imageId: string) => api.delete(`/topics/${topic.id}/images/${imageId}`),
    onSuccess: onChanged,
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const ct = file.type || "image/jpeg";
        const { data: up } = await api.post(`/topics/${topic.id}/images/upload-url`, {
          content_type: ct,
        });
        await uploadToPresigned(up.upload_url, file, ct);
        await api.post(`/topics/${topic.id}/images`, { image_key: up.image_key });
      }
      onChanged();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card hover>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            background: `linear-gradient(135deg, oklch(0.78 0.11 ${hue}), oklch(0.65 0.16 ${hue}))`,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="layers" size={24} />
        </div>
        {!editing && (
          <div className="row gap-1">
            <button style={iconBtn} className="tap" title={t("rename")} onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} />
            </button>
            <button
              style={iconBtn}
              className="tap"
              title={t("delete")}
              onClick={async () => {
                if (
                  await ask({
                    message: t("deleteTopicConfirm"),
                    confirmText: t("delete"),
                    destructive: true,
                  })
                )
                  removeTopic.mutate();
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="row gap-2" style={{ marginBottom: 12 }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ ...inp, flex: 1 }}
          />
          <Button size="sm" onClick={() => rename.mutate()} disabled={!name.trim() || rename.isPending}>
            {t("save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(topic.name);
              setEditing(false);
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <h3 style={{ fontSize: 18 }}>{topic.name}</h3>
      )}

      <div
        className="row gap-2"
        style={{ marginTop: 6, color: "var(--ink-soft)", fontSize: 13, fontWeight: 700 }}
      >
        <Icon name="eye" size={15} />
        {topic.images.length} {t("topicImages")}
      </div>

      {/* Image gallery */}
      {topic.images.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            marginTop: 12,
          }}
        >
          {topic.images.map((img) => (
            <div
              key={img.id}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                overflow: "hidden",
                borderRadius: "var(--r-sm)",
                background: "var(--surface-2)",
              }}
            >
              <img
                src={img.url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                onClick={async () => {
                  if (
                    await ask({
                      message: t("deleteImageConfirm"),
                      confirmText: t("delete"),
                      destructive: true,
                    })
                  )
                    removeImage.mutate(img.id);
                }}
                style={{
                  position: "absolute",
                  top: 5,
                  right: 5,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "none",
                  background: "oklch(0 0 0 / 0.55)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={14} sw={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        variant="soft"
        size="sm"
        icon="plus"
        full
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{ marginTop: 14 }}
      >
        {uploading ? t("uploading") : t("addImages")}
      </Button>
    </Card>
  );
}
