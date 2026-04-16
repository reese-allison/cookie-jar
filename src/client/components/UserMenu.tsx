import { signOut } from "../lib/auth-client";

interface UserMenuProps {
  displayName: string;
  image?: string;
}

export function UserMenu({ displayName, image }: UserMenuProps) {
  return (
    <div className="user-menu">
      {image && <img className="user-menu__avatar" src={image} alt="" width={28} height={28} />}
      <span className="user-menu__name">{displayName}</span>
      <button type="button" className="user-menu__signout" onClick={() => signOut()}>
        Sign out
      </button>
    </div>
  );
}
