import React, { useState, useEffect } from 'react';

export function TaskApprovals() {
  const [tasks, setTasks] = useState<{id: string, goal: string, status: string}[]>([]);
  const [role, setRole] = useState<'admin' | 'operator'>('admin');
  const [backupStatus, setBackupStatus] = useState<string>('');

  const loadTasks = async () => {
    try {
      const res = await fetch('/api/copilotkit/tasks');
      if (res.ok) {
        setTasks(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (id: string) => {
    const res = await fetch(`/api/copilotkit/tasks/${id}/approve`, { 
      method: 'POST',
      headers: { 'x-user-role': role }
    });
    if (res.ok) {
      setTasks(ts => ts.map(t => t.id === id ? { ...t, status: 'queued' } : t));
      loadTasks();
    } else {
      alert('Forbidden: Only Admins can approve tasks.');
    }
  };

  const handleBackup = async () => {
    setBackupStatus('Backing up...');
    const res = await fetch('/api/copilotkit/backup', {
      method: 'POST',
      headers: { 'x-user-role': role }
    });
    if (res.ok) {
      setBackupStatus('Backup complete!');
      setTimeout(() => setBackupStatus(''), 3000);
    } else {
      setBackupStatus('Backup failed (Forbidden)');
    }
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <h2 className="text-xl font-bold">Task Orchestrator & Approvals</h2>
        <div className="flex items-center gap-4">
          <select 
            value={role} 
            onChange={e => setRole(e.target.value as any)}
            className="border rounded p-1"
          >
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
          </select>
          <button onClick={handleBackup} className="bg-gray-800 text-white px-3 py-1 rounded text-sm">
            Backup System
          </button>
          {backupStatus && <span className="text-sm text-green-600">{backupStatus}</span>}
        </div>
      </div>
      <div className="space-y-4">
        {tasks.map(task => (
          <div key={task.id} className="border p-4 rounded-lg bg-gray-50 flex justify-between items-center">
            <div>
              <div className="font-semibold">{task.goal}</div>
              <div className="text-sm text-gray-500">Status: {task.status}</div>
            </div>
            {task.status === 'pending_approval' && (
              <button 
                onClick={() => handleApprove(task.id)}
                className="bg-green-600 text-white px-4 py-2 rounded"
              >
                Approve & Execute
              </button>
            )}
          </div>
        ))}
        {tasks.length === 0 && <div className="text-gray-500">No tasks in queue.</div>}
      </div>
    </div>
  );
}
