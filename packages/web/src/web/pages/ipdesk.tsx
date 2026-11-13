import { useRef, useState } from "react";
import { Link } from "wouter";
import { Btn, Card, Empty, ErrorLine, Field, Loading, OkLine, PageHead, Pill, newKey } from "../components/bits";
import { useSession } from "../components/session";
import { useAttorneyReview, useFetchFiling, useFiling, useGenerateFiling, useIpPreview, useIpTemplates, useMyFilings } from "../queries/ipdesk";
import { useMyProjects } from "../queries/projects";
import { date, errMsg, money } from "../lib/format";
import { log } from "../lib/log";

const label = (s: string) => s.split("_").join(" ");

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]/gi, "_")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Templates and live drafts are open to everyone; saving a draft needs a passport. */
export default function IpDeskPage() {
  const { member } = useSession();
  const signedIn = !!member;
  const templates = useIpTemplates();
  type Kind = NonNullable<typeof templates.data>[number]["kind"];
  const [kind, setKind] = useState<Kind>("nda");
  const [form, setForm] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const attemptKey = useRef(newKey());
  const preview = useIpPreview(kind, form);
  const projects = useMyProjects(signedIn);
  const generate = useGenerateFiling();
  const t = templates.data?.find((item) => item.kind === kind);
  const missing = (t?.fields ?? []).filter((f) => f.required && !(form[f.name] ?? "").trim()).map((f) => f.label);

  function save(e: React.FormEvent) {
    e.preventDefault();
    // Form contents are confidential drafting material: log the shape of the request only.
    log.decide("ipdesk", "Draft save requested", { kind, linkedProject: !!projectId, fields: Object.keys(form).length });
    generate.mutate(
      { kind, title, formData: form, projectId: projectId ? Number(projectId) : undefined, idempotencyKey: attemptKey.current },
      {
        onSuccess: () => {
          attemptKey.current = newKey();
          setOk("Draft saved below. No filing has been made.");
        },
      },
    );
  }

  return (
    <div>
      <PageHead kicker="Forge Club · IP Desk" title="Protect the work">
        Document preparation, not legal representation. No submission to a government office happens here.
      </PageHead>
      <Card className="mb-6 border-primary">
        <b>Review required.</b>
        <p className="mt-2 text-sm text-muted-foreground">
          These are drafts, not legal advice. Have a licensed attorney in the relevant jurisdiction review every document before signing or filing. A review request here is a simulated queue, not an attorney engagement.
        </p>
      </Card>
      {templates.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <form className="space-y-4" onSubmit={save}>
              <Field label="Document">
                <select
                  className="k-input"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Kind);
                    setForm({});
                    attemptKey.current = newKey();
                  }}
                >
                  {templates.data?.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-sm text-muted-foreground">{t?.blurb}</p>
              <Field label="Draft title">
                <input className="k-input" required minLength={2} maxLength={140} aria-label="Draft title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              {signedIn && !!projects.data?.length && (
                <Field label="Link to one of your rounds" help="Optional. Only rounds you created can be linked.">
                  <select className="k-input" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Linked round">
                    <option value="">None</option>
                    {projects.data.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {t?.fields.map((f) => {
                const set = (v: string) => setForm({ ...form, [f.name]: v });
                return (
                  <Field key={f.name} label={`${f.label}${f.required ? " *" : ""}`} help={f.help}>
                    {f.type === "textarea" ? (
                      <textarea className="k-input min-h-24" aria-label={f.label} required={f.required} value={form[f.name] ?? ""} onChange={(e) => set(e.target.value)} />
                    ) : f.type === "select" ? (
                      <select className="k-input" aria-label={f.label} required={f.required} value={form[f.name] ?? ""} onChange={(e) => set(e.target.value)}>
                        <option value="">Select…</option>
                        {f.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="k-input" type={f.type} aria-label={f.label} required={f.required} value={form[f.name] ?? ""} onChange={(e) => set(e.target.value)} />
                    )}
                  </Field>
                );
              })}
              <div className="border-t border-border pt-4 text-sm">
                <p>
                  Desk preparation fee (sim): <b>{money(t?.deskFeeCents)}</b>
                  {signedIn && <span className="text-muted-foreground"> · wallet {money(member?.walletCents)}</span>}
                </p>
                <p className="mt-2 text-muted-foreground">
                  Government fee: separate, paid directly to the office. {t?.govFeeNote} Listed figures are unverified historical estimates; check the official schedule.
                </p>
              </div>
              {signedIn ? (
                <>
                  {missing.length > 0 && <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}</p>}
                  <Btn type="submit" loading={generate.isPending} disabled={missing.length > 0 || (member?.walletCents ?? 0) < (t?.deskFeeCents ?? 0)}>
                    Save draft · {money(t?.deskFeeCents)}
                  </Btn>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The live draft is free to preview. <Link to="/join" className="k-link">Sign in</Link> to save and download it.
                </p>
              )}
              <ErrorLine error={generate.error} />
              <OkLine>{ok}</OkLine>
            </form>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div className="k-label">Live draft · not filed</div>
              {preview.data?.documentText && (
                <Btn variant="ghost" className="py-1 text-xs" onClick={() => download(preview.data!.documentText, title || label(kind))}>
                  Download preview
                </Btn>
              )}
            </div>
            {preview.isLoading ? <Loading /> : <pre className="mt-4 max-h-[800px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">{preview.data?.documentText}</pre>}
            <ErrorLine error={preview.error} />
          </Card>
        </div>
      )}
      <ErrorLine error={templates.error} />
      {signedIn && <MyDocuments />}
    </div>
  );
}

function MyDocuments() {
  const filings = useMyFilings(true);
  const review = useAttorneyReview();
  const fetchFiling = useFetchFiling();
  const [openId, setOpenId] = useState<number | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const opened = useFiling(openId);

  async function grab(id: number, name: string) {
    setDlError(null);
    try {
      const f = await fetchFiling(id);
      log.decide("ipdesk", "Draft downloaded", { filingId: id });
      download(f.documentText, name);
    } catch (error) {
      log.warn("ipdesk", "Draft download failed", { filingId: id });
      setDlError(errMsg(error));
    }
  }

  return (
    <section>
      <h2 className="k-display mt-10 text-3xl">Your documents</h2>
      {filings.isLoading ? (
        <Loading />
      ) : !filings.data?.length ? (
        <div className="mt-4">
          <Empty>No drafts yet.</Empty>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {filings.data.map((f) => (
            <Card key={f.id}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Pill tone={f.status === "attorney_review" ? "warn" : "muted"}>{label(f.status)}</Pill>
                    <span className="capitalize">{label(f.kind)}</span>
                    <span>{date(f.createdAt)}</span>
                    {f.projectId && (
                      <Link to={`/forge/project/${f.projectId}`} className="k-link">
                        round #{f.projectId}
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn variant="ghost" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                    {openId === f.id ? "Hide" : "View"}
                  </Btn>
                  <Btn variant="outline" onClick={() => void grab(f.id, f.title)}>
                    Download
                  </Btn>
                  <Btn
                    disabled={f.status !== "generated"}
                    loading={review.isPending && review.variables?.filingId === f.id}
                    onClick={() => {
                      log.decide("ipdesk", "Attorney review requested", { filingId: f.id });
                      review.mutate({ filingId: f.id });
                    }}
                  >
                    {f.status === "attorney_review" ? "In review queue" : "Request review"}
                  </Btn>
                </div>
              </div>
              {openId === f.id && (
                <div className="mt-4 border-t border-border pt-4">
                  {opened.isLoading ? (
                    <Loading />
                  ) : (
                    <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">{opened.data?.documentText}</pre>
                  )}
                  <ErrorLine error={opened.error} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <ErrorLine error={filings.error ?? review.error} />
      {dlError && <p className="mt-2 text-sm text-destructive">{dlError}</p>}
      <OkLine>{review.data?.message}</OkLine>
    </section>
  );
}
