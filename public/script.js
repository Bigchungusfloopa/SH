const heading = document.querySelector("h1");
const input = document.querySelector("#todoInput");
const button = document.getElementById("addButton");
const list = document.getElementById("todoList");

button.addEventListener("click", () => {

    const text = input.value.trim();

    if (text == "") return;

    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);

    input.value = "";


});

console.log(heading);
console.log(input);
console.log(button);
console.log(list);