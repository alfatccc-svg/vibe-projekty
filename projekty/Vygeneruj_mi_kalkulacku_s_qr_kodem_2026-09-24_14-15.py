import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
import qrcode
import io

# Hlavní třída kalkulačky
class Calculator(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Kalkulačka s QR kódem")
        self.geometry("350x500")
        self.resizable(False, False)

        # Zobrazení vstupu a výsledku
        self.display = ttk.Entry(self, font=("Arial", 24), justify="right")
        self.display.pack(fill="x", padx=10, pady=10)

        # Rámec pro tlačítka
        btn_frame = ttk.Frame(self)
        btn_frame.pack(padx=10, pady=10)

        # Rozvržení tlačítek
        btn_texts = [
            ["7", "8", "9", "/"],
            ["4", "5", "6", "*"],
            ["1", "2", "3", "-"],
            ["0", ".", "=", "+"],
            ["C", "QR"]
        ]

        for r, row in enumerate(btn_texts):
            for c, txt in enumerate(row):
                btn = ttk.Button(btn_frame, text=txt, command=lambda t=txt: self.on_button(t))
                btn.grid(row=r, column=c, padx=5, pady=5, ipadx=10, ipady=10, sticky="nsew")
                btn_frame.grid_columnconfigure(c, weight=1)

        # Šířka řádků
        for r in range(len(btn_texts)):
            btn_frame.grid_rowconfigure(r, weight=1)

        # Oblast pro QR kód
        self.qr_label = ttk.Label(self)
        self.qr_label.pack(pady=10)

    # Zpracování stisků tlačítek
    def on_button(self, char):
        if char == "C":
            self.display.delete(0, tk.END)
            self.qr_label.config(image="")  # Vymazat QR
        elif char == "=":
            expr = self.display.get()
            try:
                # Bezpečné vyhodnocení základních aritmetických operací
                result = eval(expr, {"__builtins__": None}, {})
                self.display.delete(0, tk.END)
                self.display.insert(tk.END, str(result))
                self.generate_qr(str(result))
            except Exception:
                self.display.delete(0, tk.END)
                self.display.insert(tk.END, "Error")
        elif char == "QR":
            # Vygenerovat QR kód z aktuálního obsahu displeje
            self.generate_qr(self.display.get())
        else:
            # Přidat znak do vstupu
            self.display.insert(tk.END, char)

    # Vytvoření QR kódu a zobrazení v GUI
    def generate_qr(self, data):
        if not data:
            return
        qr = qrcode.QRCode(box_size=6, border=2)
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        # Převod na formát, který Tkinter zvládne
        with io.BytesIO() as output:
            img.save(output, format="PNG")
            output.seek(0)
            pil_img = Image.open(output)
            tk_img = ImageTk.PhotoImage(pil_img)
            self.qr_label.config(image=tk_img)
            self.qr_label.image = tk_img  # Udržet referenci

if __name__ == "__main__":
    app = Calculator()
    app.mainloop()