import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

export default function Org() {
  const depts = useQuery(() => supabase.from('departments').select('id,name,brand').order('name'), []);
  const groups = useQuery(() => supabase.from('groups').select('id,name').order('name'), []);
  const [dept, setDept] = useState({ name: '', brand: '' });
  const [group, setGroup] = useState('');
  const [err, setErr] = useState(null);

  async function addDept(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('departments').insert({ name: dept.name, brand: dept.brand || null });
    if (error) return setErr(error);
    setDept({ name: '', brand: '' }); depts.refetch();
  }
  async function addGroup(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('groups').insert({ name: group });
    if (error) return setErr(error);
    setGroup(''); groups.refetch();
  }
  const del = (table, q, refetch) => async () => {
    const { error } = await q; if (error) return setErr(error); refetch();
  };

  return (
    <>
      <div className="page-title"><h1>Departments &amp; Groups</h1></div>
      <ErrorBanner error={err} />
      <div className="grid cols-2">
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
              { key: 'brand', label: 'Brand' },
              { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('departments', supabase.from('departments').delete().eq('id', r.id), depts.refetch)} /> },
            ]}
          />
        </Card>

        <Card title="Groups">
          <form onSubmit={addGroup} className="row" style={{ marginBottom: 12 }}>
            <Field label="Name *"><input required value={group} onChange={(e) => setGroup(e.target.value)} /></Field>
            <button className="btn primary">Add</button>
          </form>
          <Table
            loading={groups.loading} rows={groups.data} empty="No groups yet."
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('groups', supabase.from('groups').delete().eq('id', r.id), groups.refetch)} /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
