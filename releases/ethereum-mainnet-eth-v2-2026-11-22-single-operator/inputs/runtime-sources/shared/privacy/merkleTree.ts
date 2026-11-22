/**
 * Fixed-depth incremental Merkle tree (binary, Poseidon-2 inner nodes).
 *
 * Mirrors MerkleTreeWithHistory.sol: leaves are appended left-to-right, empty
 * positions hold ZERO_VALUE, and zeros[i+1] = H(zeros[i], zeros[i]).
 * The same class is used for the on-chain state tree (commitments) and the
 * off-chain association-set tree (labels).
 */
import { SNARK_SCALAR_FIELD, TREE_DEPTH, ZERO_VALUE } from "./constants";
import { hash2 } from "./poseidon";

export interface MerkleProof {
  leaf: bigint;
  index: number;
  siblings: bigint[];
  root: bigint;
}

export function computeZeros(depth: number = TREE_DEPTH, zero: bigint = ZERO_VALUE): bigint[] {
  const zeros: bigint[] = [zero];
  for (let i = 0; i < depth; i++) zeros.push(hash2(zeros[i], zeros[i]));
  return zeros;
}

export class MerkleTree {
  readonly depth: number;
  readonly zeros: bigint[];
  /** layers[0] = leaves, layers[depth] = [root] */
  private layers: bigint[][];

  constructor(depth: number = TREE_DEPTH, leaves: bigint[] = [], zero: bigint = ZERO_VALUE) {
    if (depth < 1 || depth > 32) throw new Error("unsupported depth");
    this.depth = depth;
    this.zeros = computeZeros(depth, zero);
    this.layers = Array.from({ length: depth + 1 }, () => []);
    for (const leaf of leaves) this.insert(leaf);
  }

  get size(): number {
    return this.layers[0].length;
  }

  get capacity(): number {
    return 2 ** this.depth;
  }

  get leaves(): readonly bigint[] {
    return this.layers[0];
  }

  get root(): bigint {
    return this.layers[this.depth][0] ?? this.zeros[this.depth];
  }

  private node(level: number, index: number): bigint {
    return this.layers[level][index] ?? this.zeros[level];
  }

  insert(leaf: bigint): number {
    if (leaf < 0n || leaf >= SNARK_SCALAR_FIELD) throw new Error("leaf out of field");
    if (this.size >= this.capacity) throw new Error("tree is full");
    let index = this.size;
    this.layers[0].push(leaf);
    for (let level = 0; level < this.depth; level++) {
      const parentIndex = index >> 1;
      const left = this.node(level, parentIndex * 2);
      const right = this.node(level, parentIndex * 2 + 1);
      this.layers[level + 1][parentIndex] = hash2(left, right);
      index = parentIndex;
    }
    return this.size - 1;
  }

  indexOf(leaf: bigint): number {
    return this.layers[0].indexOf(leaf);
  }

  has(leaf: bigint): boolean {
    return this.indexOf(leaf) !== -1;
  }

  /**
   * Node (level, index) of the tree made of only the first `size` leaves. Nodes whose leaves all lie
   * below `size` are the same as in this tree, nodes past it are zeros; only the O(depth) nodes that
   * straddle `size` are hashed again.
   */
  private nodeAt(level: number, index: number, size: number): bigint {
    const span = 2 ** level;
    const first = index * span;
    if (first >= size) return this.zeros[level];
    if (first + span <= size) return this.node(level, index);
    return hash2(this.nodeAt(level - 1, index * 2, size), this.nodeAt(level - 1, index * 2 + 1, size));
  }

  /** Root this tree had when it held only its first `size` leaves (an earlier snapshot, e.g. an older association-set root). */
  rootAt(size: number): bigint {
    if (!Number.isInteger(size) || size < 0 || size > this.size) throw new Error("size out of range");
    return size === this.size ? this.root : this.nodeAt(this.depth, 0, size);
  }

  /** Membership proof for leaf `index`, against the root of the first `size` leaves (default: all of them). */
  proof(index: number, size: number = this.size): MerkleProof {
    if (!Number.isInteger(size) || size < 0 || size > this.size) throw new Error("size out of range");
    if (index < 0 || index >= size) throw new Error("leaf index out of range");
    const full = size === this.size;
    const siblings: bigint[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(full ? this.node(level, idx ^ 1) : this.nodeAt(level, idx ^ 1, size));
      idx >>= 1;
    }
    return { leaf: this.layers[0][index], index, siblings, root: this.rootAt(size) };
  }

  static verify(proof: MerkleProof, depth: number = TREE_DEPTH): boolean {
    if (proof.siblings.length !== depth) return false;
    let hash = proof.leaf;
    let idx = proof.index;
    for (let level = 0; level < depth; level++) {
      const sibling = proof.siblings[level];
      hash = idx & 1 ? hash2(sibling, hash) : hash2(hash, sibling);
      idx >>= 1;
    }
    return hash === proof.root;
  }

  /** Root the tree had after exactly `count` leaves were inserted (for ASP snapshots). */
  static rootOf(leaves: readonly bigint[], depth: number = TREE_DEPTH): bigint {
    return new MerkleTree(depth, [...leaves]).root;
  }
}
