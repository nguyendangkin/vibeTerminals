interface GitPanelProps {
  rootPath: string | null;
}

export function GitPanel({ rootPath }: GitPanelProps) {
  if (!rootPath) {
    return (
      <div className="git-empty">
        <p>Mở thư mục để sử dụng Git</p>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-placeholder">
        <div className="git-placeholder-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
            <circle cx="6" cy="6" r="2.5"/>
            <circle cx="6" cy="18" r="2.5"/>
            <circle cx="18" cy="9" r="2.5"/>
            <path d="M6 8.5v7"/>
            <path d="M8.5 9a5.5 5.5 0 0 1 5.5-2.5"/>
            <path d="M18 11.5v1a5.5 5.5 0 0 1-5.5 5.5H9.5"/>
          </svg>
        </div>
        <h2>Hệ thống Git</h2>
        <p className="git-placeholder-desc">
          Tính năng quản lý mã nguồn với Git sẽ được triển khai trong thời gian tới.
        </p>
        <ul className="git-placeholder-features">
          <li>Xem trạng thái thay đổi (git status)</li>
          <li>Stage / unstage file</li>
          <li>Commit, push, pull</li>
          <li>Xem lịch sử commit với graph</li>
          <li>Quản lý branch</li>
        </ul>
      </div>
    </div>
  );
}
