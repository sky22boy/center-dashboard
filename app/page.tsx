"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { db } from "./lib/firebase";

type Child = {
  id: string;
  name: string;
  sessionsTotal: number; // مثل 12
  sessionsUsed: number;  // من 0 إلى 12

  // ✅ تجديد مُعلّق (يعني دفع قبل ما يكمل 12)
  renewalPending?: boolean;
  renewalPendingAmount?: number;
  renewalPendingAt?: any; // Timestamp
};

type RenewalLog = {
  id: string;
  amount: number;
  createdAt?: Timestamp;
};

const COL = "children";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type Tone = "ok" | "warn" | "danger";
function toneByRemaining(remaining: number): Tone {
  if (remaining === 1) return "warn";
  if (remaining <= 0) return "danger";
  return "ok";
}

function fmtDateTime(ts?: Timestamp) {
  if (!ts) return "—";
  const d = ts.toDate();
  // تاريخ + وقت بشكل مفهوم
  return d.toLocaleString("ar-IQ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Page() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);

  // إضافة طفل
  const [newName, setNewName] = useState("");
  const [newTotal, setNewTotal] = useState<number>(12);

  // بحث + تحديد
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");

  // ✅ مودال سجل التجديد
  const [logOpen, setLogOpen] = useState(false);
  const [logChild, setLogChild] = useState<Child | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [renewals, setRenewals] = useState<RenewalLog[]>([]);

  // ✅ مودال التجديد (إدخال مبلغ)
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewChild, setRenewChild] = useState<Child | null>(null);
  const [renewAmount, setRenewAmount] = useState<string>("");

  useEffect(() => {
    const q = query(collection(db, COL), orderBy("name", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Child[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data.name ?? ""),
            sessionsTotal: Number(data.sessionsTotal ?? 12),
            sessionsUsed: Number(data.sessionsUsed ?? 0),

            renewalPending: Boolean(data.renewalPending ?? false),
            renewalPendingAmount:
              data.renewalPendingAmount !== undefined
                ? Number(data.renewalPendingAmount)
                : undefined,
            renewalPendingAt: data.renewalPendingAt,
          };
        });

        setChildren(list);
        setLoading(false);

        if (selectedId && !list.some((c) => c.id === selectedId)) {
          setSelectedId("");
        }
      },
      (err) => {
        console.error("Firestore snapshot error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return children;
    return children.filter((c) => c.name.toLowerCase().includes(s));
  }, [children, search]);

  const selected = useMemo(
    () => children.find((c) => c.id === selectedId) || null,
    [children, selectedId]
  );

  async function addChild() {
    const name = newName.trim();
    if (!name) return;

    const total = clamp(Number(newTotal || 12), 1, 999);

    await addDoc(collection(db, COL), {
      name,
      sessionsTotal: total,
      sessionsUsed: 0,
      renewalPending: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setNewName("");
    setNewTotal(12);
    setSearch("");
  }

  async function removeChild(id: string) {
    await deleteDoc(doc(db, COL, id));
  }

  // ✅ زيادة جلسة مع منطق "التجديد المعلّق"
  async function incSession(id: string, current: Child) {
    const total = current.sessionsTotal;
    const nextUsed = clamp(current.sessionsUsed + 1, 0, total);

    // إذا وصل 12:
    if (nextUsed >= total) {
      // إذا كان هناك تجديد مُعلّق => صفّر مباشرة وابدأ دورة جديدة
      if (current.renewalPending) {
        await updateDoc(doc(db, COL, id), {
          sessionsUsed: 0,
          renewalPending: false,
          renewalPendingAmount: null,
          renewalPendingAt: null,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      // إذا لا يوجد تجديد => يبقى على 12 (لا يرجع للصفر)
      await updateDoc(doc(db, COL, id), {
        sessionsUsed: total,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // قبل 12: تحديث طبيعي
    await updateDoc(doc(db, COL, id), {
      sessionsUsed: nextUsed,
      updatedAt: serverTimestamp(),
    });
  }

  async function decSession(id: string, current: Child) {
    const used = clamp(current.sessionsUsed - 1, 0, current.sessionsTotal);
    await updateDoc(doc(db, COL, id), {
      sessionsUsed: used,
      updatedAt: serverTimestamp(),
    });
  }

  // ✅ فتح مودال التجديد لإدخال مبلغ
  function openRenewModal(child: Child) {
    setRenewChild(child);
    setRenewAmount("");
    setRenewOpen(true);
  }

  // ✅ تنفيذ التجديد: يسجّل تاريخ/وقت/مبلغ + يجعل التجديد "معلّق"
  async function confirmRenew() {
    if (!renewChild) return;

    const amountNum = Number(String(renewAmount).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      alert("رجاءً أدخل مبلغًا صحيحًا.");
      return;
    }

    const childId = renewChild.id;

    // 1) أضف سجل داخل subcollection
    await addDoc(collection(db, COL, childId, "renewals"), {
      amount: amountNum,
      createdAt: serverTimestamp(),
    });

    // 2) علّم الطفل أن لديه تجديد مُعلّق (لا نصفر الآن)
    await updateDoc(doc(db, COL, childId), {
      renewalPending: true,
      renewalPendingAmount: amountNum,
      renewalPendingAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setRenewOpen(false);
    setRenewChild(null);
    setRenewAmount("");
  }

  // ✅ فتح سجل التجديدات
  async function openRenewalsLog(child: Child) {
    setLogChild(child);
    setLogOpen(true);
    setLogLoading(true);
    setRenewals([]);

    try {
      const q = query(
        collection(db, COL, child.id, "renewals"),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      const rows: RenewalLog[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          amount: Number(data.amount ?? 0),
          createdAt: data.createdAt,
        };
      });
      setRenewals(rows);
    } catch (e) {
      console.error(e);
      setRenewals([]);
    } finally {
      setLogLoading(false);
    }
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <h1 className="title">لوحة التحكّم</h1>
        <div className="badge">Firestore</div>
      </header>

      <section className="grid">
        {/* يسار: البحث + القائمة */}
        <div className="panel">
          <div className="panelHead">
            <h2>بحث وإدارة</h2>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم الطفل..."
            />
          </div>

          <div className="tableHead">
            <span>الاسم</span>
            <span>الجلسات</span>
            <span>المتبقي</span>
          </div>

          <div className="list">
            {loading ? (
              <div className="empty">جارٍ التحميل...</div>
            ) : filtered.length === 0 ? (
              <div className="empty">لا توجد نتائج</div>
            ) : (
              filtered.map((c) => {
                const remaining = c.sessionsTotal - c.sessionsUsed;
                const tone = toneByRemaining(remaining);
                const active = c.id === selectedId;

                return (
                  <div
                    key={c.id}
                    className={`row ${tone} ${active ? "active" : ""}`}

                    onClick={() => setSelectedId(c.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="namePill">
                      <span className="nameText">{c.name}</span>

                      {/* مؤشر بسيط إذا يوجد تجديد معلّق */}
                      {c.renewalPending ? (
                        <span className="pendingTag" title="تم التجديد مسبقًا وسيُصفّر العداد عند إكمال الجلسات">
                          مجدَّد ✓
                        </span>
                      ) : null}
                    </div>

                    <div className="cell">
                      {c.sessionsUsed}/{c.sessionsTotal}
                    </div>

                    <div className="cell">{remaining}</div>

                    <div className="actions">
                      <button
                        className="btn ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          decSession(c.id, c);
                        }}
                        type="button"
                      >
                        - جلسة
                      </button>

                      <button
                        className="btn success"
                        onClick={(e) => {
                          e.stopPropagation();
                          incSession(c.id, c);
                        }}
                        type="button"
                      >
                        + جلسة
                      </button>

                      {/* ✅ زر تجديد الآن يفتح إدخال مبلغ */}
                      <button
                        className="btn warn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenewModal(c);
                        }}
                        type="button"
                      >
                        تجديد
                      </button>

                      {/* ✅ زر سجل التجديد */}
                      <button
                        className="btn primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenewalsLog(c);
                        }}
                        type="button"
                      >
                        سجل التجديد
                      </button>

                      <button
                        className="btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeChild(c.id);
                        }}
                        type="button"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* يمين: إضافة طفل */}
        <div className="panel">
          <div className="panelHead">
            <h2>إضافة طفل</h2>
          </div>

          <label className="field">
            <span>اسم الطفل</span>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثال: محمد"
            />
          </label>

          <label className="field">
            <span>عدد الجلسات (عند الإضافة)</span>
            <input
              className="input"
              type="number"
              value={newTotal}
              onChange={(e) => setNewTotal(Number(e.target.value))}
              min={1}
            />
          </label>

          <button className="btn primary full" onClick={addChild} type="button">
            إضافة
          </button>

          {selected ? (
            <div className="selectedBox">
              <span className="selectedLabel">المحدّد:</span>
              <span className="selectedValue">{selected.name}</span>
            </div>
          ) : (
            <div className="selectedBox mutedBox">اختر طفلًا من القائمة لإدارته</div>
          )}
        </div>
      </section>

      {/* ✅ نافذة إدخال مبلغ التجديد */}
      {renewOpen && renewChild ? (
        <div className="modalOverlay" onClick={() => setRenewOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">تجديد اشتراك</div>
            <div className="modalSub">
              الطفل: <strong>{renewChild.name}</strong>
            </div>

            <label className="field" style={{ marginTop: 10 }}>
              <span>المبلغ المدفوع</span>
              <input
                className="input"
                value={renewAmount}
                onChange={(e) => setRenewAmount(e.target.value)}
                placeholder="مثال: 25000"
                inputMode="numeric"
              />
            </label>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setRenewOpen(false)} type="button">
                إلغاء
              </button>
              <button className="btn warn" onClick={confirmRenew} type="button">
                حفظ التجديد
              </button>
            </div>

            <div className="modalHint">
              ملاحظة: إذا تم التجديد قبل إكمال {renewChild.sessionsTotal} جلسة، فلن يُصفّر العداد الآن، بل يُصفّر تلقائيًا عند إكمال الجلسات.
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ نافذة سجل التجديد */}
      {logOpen && logChild ? (
        <div className="modalOverlay" onClick={() => setLogOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">سجل التجديد</div>
            <div className="modalSub">
              الطفل: <strong>{logChild.name}</strong>
            </div>

            {/* حالة التجديد المعلّق */}
            <div className="logMeta">
              <span>
                الحالة:{" "}
                {logChild.renewalPending ? (
                  <strong style={{ color: "#fbbf24" }}>تجديد مُعلّق</strong>
                ) : (
                  <strong style={{ color: "#9ca3af" }}>لا يوجد تجديد مُعلّق</strong>
                )}
              </span>
              {logChild.renewalPending ? (
                <span>
                  آخر مبلغ: <strong>{logChild.renewalPendingAmount ?? "—"}</strong> —{" "}
                  {fmtDateTime(logChild.renewalPendingAt)}
                </span>
              ) : null}
            </div>

            <div className="logBox">
              {logLoading ? (
                <div className="empty">جارٍ التحميل...</div>
              ) : renewals.length === 0 ? (
                <div className="empty">لا يوجد تجديدات مسجّلة.</div>
              ) : (
                <div className="logTable">
                  <div className="logHead">
                    <span>التاريخ والوقت</span>
                    <span>المبلغ</span>
                  </div>
                  {renewals.map((r) => (
                    <div className="logRow" key={r.id}>
                      <span>{fmtDateTime(r.createdAt)}</span>
                      <span>{r.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modalActions">
              <button className="btn primary" onClick={() => setLogOpen(false)} type="button">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
