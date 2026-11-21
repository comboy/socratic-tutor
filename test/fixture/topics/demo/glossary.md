# Glossary — LLMs (demo)

Synthetic glossary for UI tests. Entries follow the pipeline: tokens, output, attention, training.

## token
aliases: token ID, token IDs
skill: 1.1
see: vocabulary, tokenizer, embedding table
refs: 2026-01-05.5
A chunk of text (a word, a piece of a word, punctuation) with an integer ID. The model reads and writes only tokens.

## vocabulary
aliases: vocab, vocab size
skill: 1.1
size: 32,000 tokens
see: token, logits
A fixed list of every token the model knows. It sets the number of logits.

## tokenizer
skill: 1.1, 1.3
see: token, BPE
refs: 2026-01-05.5
The program that splits text into tokens from the vocabulary.

## special tokens
aliases: special token, role tokens
skill: 1.2
see: token
Reserved tokens that mark structure: start or end of text, and where each chat turn begins.

## BPE
aliases: byte-pair encoding
full: **B**yte-**P**air **E**ncoding
parts: token, vocabulary, tokenizer
skill: 1.3
see: tokenizer
A way to build the vocabulary: start from single bytes and repeatedly merge the most frequent adjacent pair.

## embedding table
aliases: embedding, embeddings
skill: 1.1
size: 32k × 4096
see: token
A learned matrix with one row per vocabulary token. A token's row is its starting vector.

## logits
aliases: logit
skill: 3.1
see: softmax, unembedding
refs: 2026-01-05.7
One raw score per vocabulary token, computed from the last position's vector. Not probabilities: they can be negative.

## unembedding
aliases: W_U, unembedding matrix
skill: 3.1
size: 4096 × 32k
see: logits
The matrix with one column per vocabulary token that turns the final vector into logits.

## softmax
aliases: soft-max
skill: 3.2, 4.1
see: logits, temperature, attention weights
refs: 2026-01-05.10, 2026-01-05.12
Turns any list of scores into positive weights that sum to 1: e^z / Σe^z.

Only differences between scores matter, because a constant added to every score cancels between the top and the bottom of the fraction.

```viz bars
{ title: "softmax([2, 1, 0])", items: [{label: "a", value: 0.665}, {label: "b", value: 0.245}, {label: "c", value: 0.09}], format: "pct" }
```

## temperature
skill: 3.2
see: softmax, sampling
refs: 2026-01-05.10
A number the logits are divided by before softmax. Low T sharpens the distribution, high T flattens it.

## sampling
aliases: greedy decoding, top-k, top-p
skill: 3.3
see: temperature
How the next token is picked from the probabilities: always the top one (greedy) or drawn at random.

## QKV
aliases: query, queries, key vector, value vector, W_Q, W_K, W_V
skill: 4.1
size: 128 each per head
see: dot product, attention weights
refs: 2026-01-06.5
Each token's vector times three learned matrices: the query (what it looks for), the key (how it's found) and the value (what it hands over).

## dot product
skill: 4.1
see: QKV, logits
Multiply two vectors position by position and add up the results. Large when the vectors point the same way.

## attention weights
aliases: attention weight, attention scores
skill: 4.1
see: softmax, QKV
refs: 2026-01-06.5
The [softmax](term:softmax) of one query's scores against every earlier key; they say how much each token contributes ([worked example](msg:2026-01-06.7)).

## attention head
aliases: head, heads, attention heads
skill: 4.2
see: multi-head attention, QKV
refs: 2026-01-06.14
One set of W_Q, W_K, W_V and its own attention pattern. A layer runs many in parallel.

## multi-head attention
aliases: MHA
skill: 4.2
see: attention head
refs: 2026-01-06.17
Running many attention heads side by side and combining their outputs, so a layer can do several lookups at once.

## causal mask
aliases: causal masking
skill: 4.3
see: attention weights
A rule that a token may only attend to itself and earlier tokens.

## KV cache
aliases: kv cache, key-value cache
skill: 4.4
full: **K**ey–**V**alue cache
size: grows with every token
see: QKV, attention head
refs: 2026-01-08.13
Memory holding the keys and values of all earlier tokens, so generation only computes them for the new token.

## cross-entropy loss
aliases: cross-entropy, loss
skill: 6.1
see: softmax, gradient descent
refs: 2026-01-08.5
−log of the probability the model gave to the correct next token, averaged over positions.

## learning rate
aliases: lr, step size
skill: 6.2
see: gradient descent
refs: 2026-01-08.8
How big a step gradient descent takes: w ← w − lr · g.

## gradient descent
skill: 6.2
see: learning rate, gradient, cross-entropy loss
refs: 2026-01-08.8
Repeatedly nudging every weight against its gradient to lower the loss.

## gradient
aliases: gradients
skill: 6.2, 6.3
see: gradient descent, backpropagation
For each weight, how much the loss would change if that weight went up a little.

## backpropagation
aliases: backprop
skill: 6.3
see: gradient
The algorithm that computes every weight's gradient in one backward pass through the network.
