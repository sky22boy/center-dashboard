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
} from "firebase/firestore";
import { db } from "./lib/firebase";

type Child = {
  id: string;
  name: string;
  sessionsTotal: number;
  sessionsUsed: number;
};

const COL = "children";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toneByRemaining(remaining: number) {
  // قبل الأخيرة = أصفر (المتبقي 1)
  if (remaining === 1) return "warn";
  // الأخيرة/خلص = أحمر (المتبقي 0 أو أقل)
  if (remaining <= 0) return "danger";
  // غير ذلك = أخضر
  return "ok";
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

  async function incSession(id: string, current: Child) {
    const used = clamp(current.sessionsUsed + 1, 0, current.sessionsTotal);
    await updateDoc(doc(db, COL, id), {
      sessionsUsed: used,
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

  async function renew(id: string) {
    // التجديد: يصير 0 من total
    await updateDoc(doc(db, COL, id), {
      sessionsUsed: 0,
      updatedAt: serverTimestamp(),
    });
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
                    <div className="name">{c.name}</div>
                    <div className="cell">
                      {c.sessionsUsed}/{c.sessionsTotal}
                    </div>
                    <div className="cell">{remaining}</div>

                    {/* الأزرار بجانب اسم الطفل */}
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
                      <button
                        className="btn warn"
                        onClick={(e) => {
                          e.stopPropagation();
                          renew(c.id);
                        }}
                        type="button"
                      >
                        تجديد
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
    </main>
  );
}
