#!/usr/bin/env python3
import sys

if len(sys.argv) != 2:
    print("Usage: get_vertex_stats.py model.obj")
    sys.exit(1)

obj_path = sys.argv[1]

vertices = []        # store full 'v' lines
used_indices = set() # 1-based vertex indices used anywhere

with open(obj_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split()

        # Vertex definition
        if parts[0] == "v":
            vertices.append(line)
            continue

        # Faces / lines / points can reference vertex indices
        if parts[0] in ("f", "l", "p"):
            for ref in parts[1:]:
                # ref can be like "v", "v/vt", "v//vn", "v/vt/vn"
                v_str = ref.split("/")[0]
                if not v_str:
                    continue

                try:
                    idx = int(v_str)
                except ValueError:
                    continue

                # Handle negative indices (relative to end of vertex array)
                if idx < 0:
                    idx = len(vertices) + 1 + idx  # because OBJ is 1-based

                # Only record if valid
                if 1 <= idx <= len(vertices):
                    used_indices.add(idx)

# Now figure out which vertices are unused
unused = [i for i in range(1, len(vertices) + 1) if i not in used_indices]

print(f"Total vertices: {len(vertices)}")
print(f"Used vertices : {len(used_indices)}")
print(f"Unused vertices: {len(unused)}")

if unused:
    print("\nUnused vertex indices and lines:")
    for i in unused:
        print(f"{i}: {vertices[i-1]}")
