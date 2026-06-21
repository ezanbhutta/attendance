import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner, InlineEdit } from '../components/ui.jsx';

export default function Org() {
  const depts = useQuery(() => supabase.from('departments').select('id,name').order('name'), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);

  async function addDept(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('departments').insert({ name: name.trim() });
    if (error) return setErr(error);
    setName(''); depts.refetch();
  }

  async function rename(id, newName) {
    setErr(null);
    const { error } = await supabase.from('departments').update({ name: newName }).eq('id', id);
    if (error) setErr(error); else depts.refetch();
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
          <p className="page-intro">Group your team so reports can be filtered. Click a name to rename it. You assign people to a department on the Employees page.</p>
        </div>
      </div>
      <ErrorBanner error={err} />
      <Card title="Departments">
        <form onSubmit={addDept} className="row" style={{ marginBottom: 18 }}>
          <Field label="Name *"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Creative" /></Field>
          <button className="btn primary">Add department</button>
        </form>
        <Table
          loading={depts.loading} rows={depts.data} empty="No departments yet."
          columns={[
            { key: 'name', label: 'Name', render: (r) => <InlineEdit value={r.name} onSave={(v) => rename(r.id, v)} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={() => delDept(r.id)} /> },
          ]}
        />
      </Card>
    </>
  );
}
