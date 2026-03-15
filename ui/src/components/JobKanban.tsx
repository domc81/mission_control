import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatRelative } from 'date-fns';

interface Job {
  id: string;
  client_name: string;
  status: string;
  progress_pct: number;
  created_at: string;
  thumbnail_url?: string;
  processed_minio_path: string;
}

interface JobDetails {
  transcript?: any;
  social_copy?: string;
  hashtags?: string[];
  telegram_chat_id?: number;
}

const JobKanban: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobDetails, setJobDetails] = useState<JobDetails>({});

  const statuses = ['queued', 'processing', 'preview_sent', 'approved', 'failed'];

  const fetchJobs = async () => {
    const { data } = await supabase.from('client_jobs').select(`
      id, from_number, telegram_clients(client_name, brand_kits(client_name)),
      status, approval_status, progress_pct, processed_minio_path,
      created_at, telegram_chat_id, transcript, social_copy, hashtags
    `);
    if (data) {
      const mapped: Job[] = data.map(row => ({
        id: row.id,
        client_name: row.telegram_clients?.brand_kits?.client_name || row.from_number,
        status: row.approval_status || row.status,
        progress_pct: row.progress_pct || 0,
        created_at: row.created_at,
        processed_minio_path: row.processed_minio_path
      }));
      setJobs(mapped);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const groupByStatus = (jobs: Job[]) => {
    return statuses.reduce((acc, status) => {
      acc[status] = jobs.filter(job => job.status === status);
      return acc;
    }, {} as Record<string, Job[]>);
  };

  const groupedJobs = groupByStatus(jobs);

  const handleApprove = async (id: string) => {
    await supabase.from('client_jobs').update({ approval_status: 'approved', status: 'approved' }).eq('id', id);
    fetchJobs();
  };

  const handleReject = async (id: string) => {
    await supabase.from('client_jobs').update({ approval_status: 'rejected', status: 'rejected' }).eq('id', id);
    fetchJobs();
  };

  const loadDetails = async (job: Job) => {
    setSelectedJob(job);
    const { data } = await supabase.from('client_jobs').select('transcript, social_copy, hashtags, telegram_chat_id').eq('id', job.id).single();
    if (data) setJobDetails(data);
  };

  return (
    <div style={{ display: 'flex', gap: '20px' }}>
      {statuses.map(status => (
        <div key={status} style={{ flex: 1, border: '1px solid #ccc', padding: '10px' }}>
          <h3>{status.toUpperCase()}</h3>
          {groupedJobs[status].map(job => (
            <div key={job.id} style={{ border: '1px solid #eee', marginBottom: '10px', padding: '10px', cursor: 'pointer' }} onClick={() => loadDetails(job)}>
              <img src={job.thumbnail_url} alt="thumbnail" style={{ width: '50px', height: '50px' }} />
              <div>{job.id.slice(0, 8)}</div>
              <div>{job.client_name}</div>
              <div style={{ background: 'green', width: `${job.progress_pct}%` }}>{job.progress_pct}%</div>
              <div>{formatRelative(new Date(job.created_at), new Date())}</div>
            </div>
          ))}
        </div>
      ))}
      {selectedJob && (
        <div style={{ position: 'absolute', top: 0, right: 0, width: '300px', background: 'white', padding: '20px', border: '1px solid #ccc' }}>
          <h4>Job Details</h4>
          <p><strong>Transcript:</strong> {JSON.stringify(jobDetails.transcript)}</p>
          <p><strong>Social Copy:</strong> {jobDetails.social_copy}</p>
          <p><strong>Hashtags:</strong> {jobDetails.hashtags?.join(' ')}</p>
          <p><strong>Telegram Chat ID:</strong> {jobDetails.telegram_chat_id}</p>
          <button onClick={() => handleApprove(selectedJob.id)}>Approve</button>
          <button onClick={() => handleReject(selectedJob.id)}>Reject</button>
        </div>
      )}
    </div>
  );
};

export default JobKanban;