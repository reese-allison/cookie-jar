interface TopBarProps {
  user: { displayName: string; image?: string };
  onOpenMyJars: () => void;
  onSignOut: () => void;
}

export function TopBar({ user, onOpenMyJars, onSignOut }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__brand">Cookie Jar</div>
      <div className="top-bar__user">
        {user.image && (
          <img className="top-bar__avatar" src={user.image} alt="" width={28} height={28} />
        )}
        <span className="top-bar__name">{user.displayName}</span>
        <button type="button" className="top-bar__button" onClick={onOpenMyJars}>
          My Jars
        </button>
        <button type="button" className="top-bar__button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
