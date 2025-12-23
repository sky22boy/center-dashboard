"use client";

import { useEffect, useMemo, useState } from "react";
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
  createdAt?: any;
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const remaining = (c: Child) => Math.max(0, toNum(c.sessionsTotal) - toNum(c.sessionsUsed));

const statusVariant = (rem: number) => {
  if (rem === 0) return "danger"; // انتهت
  if (rem === 1) return "warning"; // قبل الأخيرة
  return "success";
};

export default function Home() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);

  // إضافة طفل
  const [newName, setNewName] = useState("");
  const [newTotal, setNewTotal] = useState<number>(12);

  // بحث
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = query(collection(db, "children"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Child[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name ?? "",
            sessionsTotal: toNum(data.sessionsTotal),
            sessionsUsed: toNum(data.sessionsUsed),
            createdAt: data.createdAt,
          };
        });
        setChildren(list);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return children;
    return children.filter((c) => c.name.toLowerCase().includes(s));
  }, [children, search]);

  const addChild = async () => {
    const name = newName.trim();
    const total = toNum(newTotal) > 0 ? toNum(newTotal) : 12;
    if (!name) return;

    await addDoc(collection(db, "children"), {
      name,
      sessionsTotal: total,
      sessionsUsed: 0,
      createdAt: serverTimestamp(),
    });

    setNewName("");
    setNewTotal(12);
  };

  // ✅ كل العمليات صارت “حسب الطفل نفسه” (مو عشوائي)
  const incSession = async (child: Child) => {
    const used = toNum(child.sessionsUsed);
    const total = toNum(child.sessionsTotal);
    if (used >= total) return;

    await updateDoc(doc(db, "children", child.id), { sessionsUsed: used + 1 });
  };

  const decSession = async (child: Child) => {
    const used = toNum(child.sessionsUsed);
    if (used <= 0) return;

    await updateDoc(doc(db, "children", child.id), { sessionsUsed: used - 1 });
  };

  const renew = async (child: Child) => {
    // التجديد: يصير 0 / total
    await updateDoc(doc(db, "children", child.id), { sessionsUsed: 0 });
  };

  const removeChild = async (child: Child) => {
    const ok = confirm(`هل تريد حذف الطفل: ${child.name} ؟`);
    if (!ok) return;

    await deleteDoc(doc(db, "children", child.id));
  };

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <div className="dot" />
          <div>
            <div className="brandTitle">لوحة التحكم</div>
            <div className="brandSub">إدارة الأطفال والجلسات (Firestore)</div>
          </div>
        </div>

        <div className="headerRight">
          <div className="pill success">Firestore: متصل</div>
          <div className="pill neutral">عدد الأطفال: {children.length}</div>
        </div>
      </header>

      <div className="layout">
        {/* يمين: إضافة طفل */}
        <section className="panel">
          <div className="panelTitle">إضافة طفل</div>

          <label className="label">اسم الطفل</label>
          <input
            className="input"
            placeholder="مثال: محمد"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />

          <label className="label">عدد الجلسات عند الإضافة</label>
          <input
            className="input"
            type="number"
            value={newTotal}
            onChange={(e) => setNewTotal(Number(e.target.value))}
          />

          <button className="btn primary full" onClick={addChild}>
            إضافة
          </button>

          <div className="hint">
            يتم كل شيء من داخل الموقع: إضافة، بحث، زيادة/نقص، تجديد، حذف.
          </div>
        </section>

        {/* يسار: بحث + قائمة الأطفال */}
        <section className="panel wide">
          <div className="panelTop">
            <div className="panelTitle">بحث وإدارة</div>

            <div className="searchRow">
              <input
                className="input"
                placeholder="ابحث باسم الطفل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn ghost" onClick={() => setSearch("")}>
                مسح
              </button>
            </div>
          </div>

          <div className="tableHead">
            <div>الاسم</div>
            <div className="center">الجلسات</div>
            <div className="center">المتبقي</div>
            <div className="actionsCol">إجراءات</div>
          </div>

          <div className="list">
            {loading ? (
              <div className="empty">جاري التحميل...</div>
            ) : filtered.length === 0 ? (
              <div className="empty">لا توجد نتائج.</div>
            ) : (
              filtered.map((c) => {
                const used = toNum(c.sessionsUsed);
                const total = toNum(c.sessionsTotal);
                const rem = remaining(c);
                const v = statusVariant(rem);

                return (
                  <div key={c.id} className="rowCard">
                    <div className="nameCell">{c.name}</div>

                    <div className="center mono">
                      {used} / {total}
                    </div>

                    <div className="center">
                      <span className={`pill ${v}`}>
                        {rem === 0 ? "انتهت" : rem === 1 ? "قبل الأخيرة" : `متبقي: ${rem}`}
                      </span>
                    </div>

                    <div className="actionsCol">
                      <button className="btn small" onClick={() => decSession(c)} disabled={used <= 0}>
                        - جلسة
                      </button>

                      <button className="btn small primary" onClick={() => incSession(c)} disabled={used >= total}>
                        + جلسة
                      </button>

                      <button className="btn small warning" onClick={() => renew(c)}>
                        تجديد
                      </button>

                      <button className="btn small danger" onClick={() => removeChild(c)}>
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

