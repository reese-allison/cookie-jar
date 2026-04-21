interface TopBarPropsSignedIn {
  user: { displayName: string; image?: string };
  onOpenMyJars: () => void;
  onSignOut: () => void;
  onSignIn?: never;
}

interface TopBarPropsSignedOut {
  user: null;
  onSignIn: () => void;
  onOpenMyJars?: never;
  onSignOut?: never;
}

type TopBarProps = TopBarPropsSignedIn | TopBarPropsSignedOut;

export function TopBar(props: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__brand">Cookie Jar</div>
      <div className="top-bar__user">
        {props.user ? (
          <>
            {props.user.image && (
              <img
                className="top-bar__avatar"
                src={props.user.image}
                alt=""
                width={28}
                height={28}
              />
            )}
            <span className="top-bar__name">{props.user.displayName}</span>
            <button type="button" className="top-bar__button" onClick={props.onOpenMyJars}>
              My Jars
            </button>
            <button type="button" className="top-bar__button" onClick={props.onSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            className="top-bar__button top-bar__button--primary"
            onClick={props.onSignIn}
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
