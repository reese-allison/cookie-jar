import { useState } from "react";

interface CreateJarProps {
  onCreate: (name: string) => void;
  isCreating: boolean;
}

export function CreateJar({ onCreate, isCreating }: CreateJarProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onCreate(trimmed);
    }
  };

  return (
    <div className="create-jar">
      <h3>Start a new jar</h3>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jar name"
          maxLength={100}
          disabled={isCreating}
        />
        <button type="submit" disabled={isCreating || !name.trim()}>
          {isCreating ? "Creating..." : "Create Jar"}
        </button>
      </form>
    </div>
  );
}
