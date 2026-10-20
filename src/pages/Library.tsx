import { useEffect, useState } from 'react';
import { deleteProject, listProjects, saveProject, type Project } from '../store/project';
import { importProjectFile } from '../store/projectFile';
import { savePCM } from '../store/assets';
import { useStudio } from '../ui/studio';

export default function Library({ go }: { go: (r: string) => void }) {
  const st = useStudio(); const [list, setList] = useState<Project[]>([]); const [err, setErr] = useState<string | null>(null);
  const refresh = () => listProjects().then(setList);
  useEffect(() => { refresh(); }, [st.savedAt]);
  const imp = async (f?: File) => {
    if (!f) return;
    try { const { project, assets } = await importProjectFile(f); for (const [id, p] of assets) await savePCM(id, p); await saveProject(project); await st.open(project.id); refresh(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      <h2>Project Library</h2>
      <p className="sub">Projects autosave to this device (IndexedDB) and reopen after reload — including offline.</p>
      {err && <div className="notice bad">{err}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => { st.create(); go('cover'); }}>+ New project</button>
        <button className="btn" onClick={() => st.saveNow().then(refresh)}>Save current</button>
        <label className="btn">Import .zmfproj…<input hidden type="file" onChange={(e) => imp(e.target.files?.[0])} /></label>
      </div>
      {!list.length && <div className="notice info">No saved projects yet.</div>}
      <table><thead><tr><th>Name</th><th>Tracks</th><th>Updated</th><th></th></tr></thead><tbody>
        {list.map((p) => <tr key={p.id} style={p.id === st.project.id ? { background: 'var(--panel2)' } : {}}>
          <td><b>{p.name}</b>{p.syntheticContent && <> <span className="tag v">AI vocals</span></>}</td><td>{p.tracks.length}</td><td>{new Date(p.updatedAt).toLocaleString()}</td>
          <td><div className="row"><button className="btn small" onClick={async () => { await st.open(p.id); go('cover'); }}>Open</button>
            <button className="btn small" onClick={async () => { const n = prompt('Rename', p.name); if (n) { await saveProject({ ...p, name: n }); if (p.id === st.project.id) st.setProject((x) => ({ ...x, name: n })); refresh(); } }}>Rename</button>
            <button className="btn small danger" onClick={async () => { if (confirm(`Delete ${p.name}?`)) { await deleteProject(p.id); refresh(); } }}>Delete</button></div></td></tr>)}
      </tbody></table>
    </div>
  );
}
