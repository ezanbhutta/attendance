import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

export default function Org() {
  const depts = useQuery(() => supabase.from('departments').select('id,name,brand').order('name'), []);
  const [dept, setDept] = useState({ name: '', brand: '' });
  const [err, setErr] = useState(null);

  async function addDept(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('departments').insert({ name: dept.name, brand: dept.brand || null });
    if (error) return setErr(error);
    setDept({ name: '', brand: '' }); depts.refetch();
  }
  function friendly(error) {
    const msg = `${error?.message || ''} ${error?.details || ''}`;
    if (error?.code === '23503' || /foreign key/i.test(msg))
      return { message: 'Can’t delete this department — run the latest database update so deleting simply unassigns its people, or move them to another department first.' };
    return error;
  }
  async function delDept(id) {
    const { error } = await supabase.from('departments').delete().eq('id', id);
    if (error) return setErr(friendly(error));
    depts.refetch();
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Departments</h1>
          <p className="page-intro">Group your team so reports can be filtered. You assign people to a department on the Employees page.</p>
        </div>
      </div>
      <ErrorBanner error={err} />
      <Card title="Departments">
        <form onSubmit={addDept} className="row" style={{ marginBottom: 12 }}>
          <Field label="Name *"><input required value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} /></Field>
          <Field label="Brand"><input value={dept.brand} onChange={(e) => setDept({ ...dept, brand: e.target.value })} placeholder="optional" /></Field>
          <button className="btn primary">Add</button>
        </form>
        <Table
          loading={depts.loading} rows={depts.data} empty="No departments yet."
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'brand', label: 'Brand', render: (r) => r.brand ?? '—' },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={() => delDept(r.id)} /> },
          ]}
        />
      </Card>
    </>
  );
}
