#include <iostream>
#include <vector>

int main() {
    // Step 2: Look at a list of numbers (deterministic example chosen).
    std::vector<int> numbers = {3, 5, 2, 8, 6, 1};

    if (numbers.empty()) {
        std::cout << "List is empty.\n";
        return 0;
    }

    // Step 3: Assume the first number is the largest.
    int largest = numbers[0];

    // Step 4: For each remaining number in the list, update if greater.
    for (size_t i = 1; i < numbers.size(); ++i) {
        if (numbers[i] > largest) {
            largest = numbers[i];
        }
    }

    // Step 5: Display the largest number.
    // Step 6: Stop
    std::cout << largest << std::endl;

    return 0;
}
