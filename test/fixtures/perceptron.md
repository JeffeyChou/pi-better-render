**B is correct.** It satisfies all three limits: 96% accuracy, 8 ms latency, and 28 W power.

Two corrections:
- Higher launch overhead **increases latency**, not decreases it.
- The table does **not establish why** A has high latency. Batching, queueing, or overhead are possibilities, not proven causes.

**Exam-ready answer:**
> B meets all constraints. A’s 40 ms latency exceeds the 10 ms deadline despite its higher throughput.

---

# Block 7: Colab, PyTorch, and perceptrons
*Source: Lecture 05, pp. 4–20. This is background rather than the main quiz focus.*

## 1. Colab: the essentials

- A cloud-hosted **Jupyter notebook**: code, output, and text in one document.
- Cells share program state. Execution order matters.
- Supports Drive/GitHub integration and access to cloud GPUs.
- Selecting a GPU runtime does **not automatically move your tensors or model to the GPU**.

## 2. PyTorch: connect the names to their jobs

| Construct | Purpose |
|---|---|
| Tensor | An \(n\)-dimensional array |
| `x.to(device)` | Returns a tensor on the requested device; use the returned value |
| `nn.Module` | Base class for neural-network models |
| `__init__()` | Defines layers; call `super().__init__()` first |
| `forward(x)` | Defines how input flows through the model |
| `nn.Linear(m, n)` | Maps \(m\) input features to \(n\) outputs using weights and biases |

**Multiplication trap:**
- `a * b`: element-wise multiplication.
- `a @ b`: matrix multiplication for matrix inputs.

A complete minimal model:

```python
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(320, 10)

    def forward(self, x):
        return self.fc(x)
```

The slide’s abbreviated example omits `super().__init__()`; working code needs it before assigning layers.

## 3. Image preprocessing

The slides use:
- **Resize:** change image dimensions.
- **RandomHorizontalFlip:** augmentation to vary training examples.
- **ToTensor:** for typical 8-bit images, convert to a tensor and scale values from \([0,255]\) to \([0,1]\).
- **Normalize:** per channel,
  \[
  x_{\text{normalized}}=\frac{x-\text{mean}}{\text{standard deviation}}
  \]
- **Compose:** apply transforms in sequence.

Normalization does **not** guarantee the final values stay between 0 and 1.

## 4. A perceptron is a weighted sum followed by a threshold

\[
z=w_1x_1+w_2x_2+b,\qquad
y=\begin{cases}1&z>0\\0&z\leq0\end{cases}
\]

This matches the slides’ Heaviside implementation, which returns 0 at zero.

The slides also write \(z=w_1x_1+w_2x_2-\theta\), so:

\[
\boxed{b=-\theta}
\]

### AND gate

Choose \(w_1=w_2=1,\ b=-1.5\).

| Inputs | \(z=x_1+x_2-1.5\) | Output |
|---|---:|---:|
| 0, 0 | −1.5 | 0 |
| 0, 1 | −0.5 | 0 |
| 1, 0 | −0.5 | 0 |
| 1, 1 | 0.5 | 1 |

For **OR**, keeping weights at 1 and choosing \(b=-0.5\) makes either positive input sufficient.

### Why one perceptron cannot implement XOR

XOR labels opposite corners of the input square positive. **One straight decision boundary cannot separate those corners from the other two.**

An MLP uses hidden layers **with nonlinear activations** to represent more complex boundaries. Stacking linear layers alone still produces a linear mapping.

## 5. Count parameters

For `nn.Linear(m, n)` with bias:

\[
\boxed{\text{Parameters}=mn+n}
\]

There are \(mn\) weights and one bias per output neuron.

For the slides’ \(784\to30\to10\) network:

\[
(784\times30+30)+(30\times10+10)
=\boxed{23{,}860}
\]

Training learns these parameters using backpropagation and an optimizer rather than setting them by hand.

---

## Your turn: construct NAND

NAND must output **1, 1, 1, 0** for inputs **00, 01, 10, 11**.

Use:
\[
w_1=w_2=-1,\qquad b=1.5
\]

**Compute the four values of \(z\), then the four outputs.** This checks the weight/bias signs and the threshold rule together.